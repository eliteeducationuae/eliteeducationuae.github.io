import { Redirect } from 'expo-router';

/**
 * Where Google Calendar's consent screen returns on iPhone and Android (eliteeducation://calendar-connected).
 * The in-app browser normally catches this address itself; if the system opens it instead, return home.
 */
export default function CalendarConnected() {
  return <Redirect href="/" />;
}
