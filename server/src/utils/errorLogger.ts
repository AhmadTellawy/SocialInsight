const fs = require('fs');

export function logErrorToFile(context: string, error: any) {
    try {
        const errorMsg = `[${new Date().toISOString()}] ERROR in ${context}:\n${error?.stack || error?.message || String(error)}\n\n`;
        fs.appendFileSync('socialinsight_errors.log', errorMsg);
        console.error(errorMsg);
    } catch (e) {
        console.error("Failed to write to log file", e);
    }
}
