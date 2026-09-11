const fs = require('node:fs');
module.exports = class ViewEvidenceReporter {
  constructor() { this.cases = []; this.assertions = new Map(); }
  onBegin() { this.startedAt = new Date().toISOString(); }
  onStepEnd(test, result, step) {
    if (step.category !== 'expect') return;
    const value = this.assertions.get(test.id) || { total: 0, passed: 0, failed: 0, skipped: 0 };
    value.total++; value[step.error ? 'failed' : 'passed']++; this.assertions.set(test.id, value);
  }
  onTestEnd(test, result) {
    this.cases.push({ id: test.id, name: test.titlePath().filter(Boolean).join(' / '), status: result.status,
      durationMs: result.duration, assertions: this.assertions.get(test.id) || { total: 0, passed: 0, failed: 0, skipped: 0 },
      errors: result.errors.map(error => error.message), attachments: result.attachments.map(({ name, path }) => ({ name, path })) });
  }
  onEnd(result) {
    if (!process.env.VIEW_BROWSER_REPORT) throw new Error('VIEW_BROWSER_REPORT required');
    fs.writeFileSync(process.env.VIEW_BROWSER_REPORT, JSON.stringify({ startedAt: this.startedAt, completedAt: new Date().toISOString(), status: result.status, durationMs: result.duration, cases: this.cases }, null, 2));
  }
};
