import { Request, Response } from 'express';

const deprecated = (_req: Request, res: Response): void => {
    res.status(410).json({
        error: 'This endpoint is no longer available',
        code: 'OTP_ENDPOINT_DEPRECATED'
    });
};

// Purpose-less OTP endpoints cannot safely authorize any account operation.
export const sendOTP = deprecated;
export const verifyOTP = deprecated;
