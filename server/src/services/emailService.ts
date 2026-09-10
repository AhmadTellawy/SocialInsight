import { Resend } from 'resend';

export type AuthEmailPurpose = 'REGISTRATION' | 'PASSWORD_RESET' | 'EMAIL_VERIFICATION' | 'EMAIL_CHANGE';

interface AuthEmailInput {
    to: string;
    code: string;
    purpose: AuthEmailPurpose;
    idempotencyKey: string;
    expiresInMinutes: number;
}

const SUBJECTS: Record<AuthEmailPurpose, string> = {
    REGISTRATION: 'Verify your Opiniup account | أكد حسابك',
    PASSWORD_RESET: 'Reset your Opiniup password | إعادة تعيين كلمة المرور',
    EMAIL_VERIFICATION: 'Verify your email | تأكيد البريد الإلكتروني',
    EMAIL_CHANGE: 'Confirm your new email | تأكيد بريدك الجديد'
};

const COPY: Record<AuthEmailPurpose, { en: string; ar: string }> = {
    REGISTRATION: { en: 'Use this code to finish creating your account.', ar: 'استخدم هذا الرمز لإكمال إنشاء حسابك.' },
    PASSWORD_RESET: { en: 'Use this code to reset your password.', ar: 'استخدم هذا الرمز لإعادة تعيين كلمة المرور.' },
    EMAIL_VERIFICATION: { en: 'Use this code to verify your email address.', ar: 'استخدم هذا الرمز لتأكيد بريدك الإلكتروني.' },
    EMAIL_CHANGE: { en: 'Use this code to confirm your new email address.', ar: 'استخدم هذا الرمز لتأكيد بريدك الإلكتروني الجديد.' }
};

const deliveryTimeoutMs = (): number => {
    const parsed = Number.parseInt(process.env.EMAIL_DELIVERY_TIMEOUT_MS || '', 10);
    return Number.isFinite(parsed) ? Math.max(1_000, Math.min(30_000, parsed)) : 10_000;
};

const withDeliveryTimeout = async <T>(operation: Promise<T>): Promise<T> => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('Email delivery timed out'), { code: 'EMAIL_DELIVERY_TIMEOUT' })), deliveryTimeoutMs());
        timer.unref?.();
    });
    try { return await Promise.race([operation, timeout]); } finally {
        if (timer) clearTimeout(timer);
    }
};

const escapeHtml = (value: string): string => value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[character] || character));

export const maskEmail = (email: string): string => {
    const [local, domain = ''] = email.split('@');
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}${'*'.repeat(Math.max(1, Math.min(6, local.length - visible.length)))}@${domain}`;
};

export const buildAuthEmailContent = (input: Pick<AuthEmailInput, 'code' | 'purpose' | 'expiresInMinutes'>): { text: string; html: string } => {
    const copy = COPY[input.purpose];
    const code = escapeHtml(input.code);
    const minutes = Math.max(1, Math.round(input.expiresInMinutes));
    return {
        text: `${copy.en}\n\n${input.code}\n\nThis code expires in ${minutes} minute${minutes === 1 ? '' : 's'}. Do not share it. If you did not request this message, ignore it.\n\n${copy.ar}\n\nتنتهي صلاحية هذا الرمز خلال ${minutes} دقيقة. لا تشاركه. إذا لم تطلب هذه الرسالة، فتجاهلها.`,
        html: `<div dir="ltr" style="font-family:Arial,sans-serif;line-height:1.6;max-width:560px"><h2>Opiniup</h2><p>${copy.en}</p><p style="font-size:30px;font-weight:700;letter-spacing:6px">${code}</p><p>This code expires in ${minutes} minute${minutes === 1 ? '' : 's'}. Do not share it.</p><p>If you did not request this message, ignore it.</p><hr><div dir="rtl"><p>${copy.ar}</p><p style="font-size:30px;font-weight:700;letter-spacing:6px">${code}</p><p>تنتهي صلاحية هذا الرمز خلال ${minutes} دقيقة. لا تشاركه.</p><p>إذا لم تطلب هذه الرسالة، فتجاهلها.</p></div></div>`
    };
};

export const sendAuthEmail = async (input: AuthEmailInput): Promise<{ messageId: string }> => {
    return deliverEmail({ ...input, ...buildAuthEmailContent(input), subject: SUBJECTS[input.purpose] });
};

export type SecurityEmailKind = 'PASSWORD_CHANGED' | 'PASSWORD_RESET' | 'EMAIL_CHANGED' | 'USERNAME_CHANGED';
export const sendSecurityChangeEmail = async (input: { to: string; kind: SecurityEmailKind; occurredAt: Date; idempotencyKey: string }): Promise<{ messageId: string }> => {
    const names: Record<SecurityEmailKind, [string, string]> = {
        PASSWORD_CHANGED: ['Your password was changed', 'تم تغيير كلمة المرور'],
        PASSWORD_RESET: ['Your password was reset', 'تمت إعادة تعيين كلمة المرور'],
        EMAIL_CHANGED: ['Your account email was changed', 'تم تغيير بريد الحساب'],
        USERNAME_CHANGED: ['Your username was changed', 'تم تغيير اسم المستخدم']
    };
    const [en, ar] = names[input.kind];
    const date = input.occurredAt.toISOString();
    const text = `${en} on Opiniup at ${date}. If you did not make this change, secure your account using the app and contact support. Never share a password or verification code.\n\n${ar} على Opiniup في ${date}. إذا لم تُجرِ هذا التغيير، أمّن حسابك من التطبيق وتواصل مع الدعم. لا تشارك كلمة المرور أو رمز التحقق.`;
    return deliverEmail({ to: input.to, idempotencyKey: input.idempotencyKey, purpose: input.kind, subject: 'Opiniup account security | أمان حسابك', text, html: `<div style="font-family:Arial,sans-serif;white-space:pre-line">${escapeHtml(text)}</div>`, security: true });
};

const deliverEmail = async (input: { to: string; idempotencyKey: string; purpose: string; subject: string; text: string; html: string; security?: boolean }): Promise<{ messageId: string }> => {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const fromAddress = process.env.EMAIL_FROM_ADDRESS?.trim()
        || (process.env.NODE_ENV === 'production' ? '' : 'onboarding@resend.dev');
    const fromName = process.env.EMAIL_FROM_NAME?.trim()
        || (process.env.NODE_ENV === 'production' ? '' : 'Opiniup');
    if (!apiKey || !fromAddress || !fromName) {
        throw Object.assign(new Error('Email delivery is not configured'), { code: 'EMAIL_NOT_CONFIGURED' });
    }
    const from = `${fromName.replace(/[<>\r\n]/g, '')} <${fromAddress}>`;

    const resend = new Resend(apiKey);
    const response = await withDeliveryTimeout(resend.emails.send({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html
    }, { idempotencyKey: input.idempotencyKey }));

    if (response.error || !response.data?.id) {
        const error = Object.assign(new Error('Email delivery failed'), { code: response.error?.name || 'EMAIL_DELIVERY_FAILED' });
        console.error(JSON.stringify({ event: 'auth_email_delivery_failed', purpose: input.purpose, ...(!input.security ? { destination: maskEmail(input.to), errorCode: error.code } : {}) }));
        throw error;
    }

    if (!input.security) console.info(JSON.stringify({ event: 'auth_email_delivered', purpose: input.purpose, destination: maskEmail(input.to), messageId: response.data.id }));
    return { messageId: response.data.id };
};
