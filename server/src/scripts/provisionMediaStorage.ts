import 'dotenv/config';
import { getMediaStorage } from '../services/mediaStorage';

const main = async (): Promise<void> => {
  await getMediaStorage().provisionBuckets();
  console.log('Media storage buckets are provisioned.');
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Media storage provisioning failed.');
  process.exitCode = 1;
});
