import { MailerService } from '@nestjs-modules/mailer'
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import handlebars from 'handlebars'
import htmlToText from 'html-to-text'
import mjml2html from 'mjml'
import { PinoLogger } from 'nestjs-pino'
import { serializeError } from 'serialize-error'
import { FormNotificationEntity } from 'src/entity/form.notification.entity'
import { Repository } from 'typeorm/repository/Repository'
import { SubmissionEntity } from '../../entity/submission.entity'

@Injectable()
export class SubmissionNotificationService {
  constructor(
    private readonly nestMailer: MailerService,
    private readonly logger: PinoLogger,
    @InjectRepository(FormNotificationEntity)
    private readonly notificationRepository: Repository<FormNotificationEntity>,
  ) {
    logger.setContext(this.constructor.name)
  }

  public async process(submission: SubmissionEntity): Promise<void> {
    await Promise.all(
      submission.form.notifications.map(async (notification) => {
        if (!notification.enabled) {
          return
        }

        const notificationdata = await this.notificationRepository.findOne(
          notification.id,
        )

        try {
          const to = this.getEmail(
            submission,
            notification.toField?.id || notificationdata.toFieldId,
            notification.toEmail,
          )
          const from = this.getEmail(
            submission,
            notification.fromField?.id || notificationdata.fromFieldId,
            notification.fromEmail,
          )

          const template = handlebars.compile(notification.htmlTemplate)

          const html: string = mjml2html(
            template({
              // TODO add variables
            }),
            {
              minify: true,
            },
          ).html

          await this.nestMailer.sendMail({
            to,
            replyTo: from,
            subject: notification.subject,
            html,
            text: htmlToText.htmlToText(html),
          })

          this.logger.info(
            {
              form: submission.formId,
              submission: submission.id,
              notification: notification.id,
            },
            'sent notification',
          )
        } catch (e) {
          this.logger.error(
            {
              form: submission.formId,
              submission: submission.id,
              notification: notification.id,
              error: serializeError(e),
            },
            'failed to process notification',
          )
          throw e
        }
      }),
    )
  }

  private getEmail(
    submission: SubmissionEntity,
    fieldId: number,
    fallback: string,
  ): string {
    if (!fieldId) {
      return fallback
    }

    const data = submission.fields.find(
      (field) => field.fieldId === fieldId,
    )?.content

    if (!data) {
      return fallback
    }

    if (typeof data === 'string') {
      return data
    }

    return fallback
  }
}
