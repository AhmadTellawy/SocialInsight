import { runAgeGroupComputation } from './src/services/cronService';

async function main() {
    console.log('Testing Age Group Computation...');
    await runAgeGroupComputation();
    console.log('Finished.');
    process.exit(0);
}

main();
