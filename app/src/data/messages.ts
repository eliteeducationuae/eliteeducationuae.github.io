export const NOT_LINKED =
  'Your account isn’t linked yet. Ask Elite Education to add your email to your family or tutor profile, then sign in again.';

/** A message the sign-in screen must show, e.g. after a web sign-in redirect that could not finish. */
export class AuthNotice extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthNotice';
    Object.setPrototypeOf(this, AuthNotice.prototype);
  }
}
