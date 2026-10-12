/**
 * ChoreScore V3 — Local Calendar Adapter
 *
 * Honest calendar port. No remote calendar integration.
 */

import { CalendarGateway, CalendarEventOptions } from '../../application/ports';

export class LocalCalendarAdapter implements CalendarGateway {
  isAvailable(): boolean {
    return false;
  }

  async requestPermission(): Promise<boolean> {
    return false;
  }

  async createEvent(_options: CalendarEventOptions): Promise<string | null> {
    return null;
  }

  async deleteEvent(_id: string): Promise<void> {
    // No-op
  }
}
