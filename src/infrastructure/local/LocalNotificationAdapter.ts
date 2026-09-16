/**
 * ChoreScore V3 — Local Notification Adapter
 *
 * Honest local notification port. No push, no remote service.
 */

import { NotificationGateway, NotificationOptions } from '../../application/ports';

export class LocalNotificationAdapter implements NotificationGateway {
  isAvailable(): boolean {
    // Notifications are available on-device but no remote push
    return false;
  }

  async requestPermission(): Promise<boolean> {
    return false;
  }

  async scheduleNotification(_options: NotificationOptions): Promise<string> {
    return 'local-notification-not-configured';
  }

  async cancelNotification(_id: string): Promise<void> {
    // No-op
  }
}
