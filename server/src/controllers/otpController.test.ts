import assert from 'node:assert/strict';
import test from 'node:test';

const { sendOTP, verifyOTP } = require('./otpController') as typeof import('./otpController');

const createResponse = () => {
  const state: { statusCode: number; body: any } = { statusCode: 200, body: undefined };
  const response: any = {
    status(code: number) { state.statusCode = code; return response; },
    json(body: any) { state.body = body; return response; }
  };
  return { response, state };
};

for (const [name, handler] of [['send', sendOTP], ['verify', verifyOTP]] as const) {
  test(`purpose-less OTP ${name} endpoint is permanently deprecated`, async () => {
    const { response, state } = createResponse();
    await handler({ body: { identifier: 'private@example.test', code: '123456' } } as any, response);
    assert.equal(state.statusCode, 410);
    assert.deepEqual(state.body, {
      error: 'This endpoint is no longer available',
      code: 'OTP_ENDPOINT_DEPRECATED'
    });
    assert.equal(JSON.stringify(state.body).includes('123456'), false);
  });
}
