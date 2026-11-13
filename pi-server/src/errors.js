export class Fault extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function requireThat(ok, message, status = 409) {
  if (!ok) throw new Fault(status, message);
}
