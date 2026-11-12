import { Platform, Share } from 'react-native';
import { getDatabase } from '../db';
import { LOCAL_USER_ID } from '../../constants/localUser';
import { buildDataExport } from './accountData';
import type { QueueConnection } from './outbox';

/**
 * Cloud Save P10 — "Export my data": the full JSON export, handed to the
 * system share sheet on Android/iOS (React Native's built-in Share; no new
 * dependency) or downloaded as a file on the web.
 */
export async function shareDataExport(): Promise<void> {
  const db = (await getDatabase()) as unknown as QueueConnection;
  const data = await buildDataExport(db, LOCAL_USER_ID);
  const text = JSON.stringify(data, null, 2);
  const fileName = `kettleborn-export-${data.exportedAt.slice(0, 10)}.json`;
  if (Platform.OS === 'web') {
    const blob = new Blob([text], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(href);
    return;
  }
  await Share.share({ title: fileName, message: text });
}
