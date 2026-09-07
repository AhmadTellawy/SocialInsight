export { NotificationPreferencesScreen as NotificationSettingsScreen } from './settings/NotificationPreferencesScreen';
export type { NotificationPreferences as NotificationSettings, TriOption } from '../utils/notificationPreferences';
export interface NotificationSettingsScreenProps { userId?: string; onBack: () => void; }
