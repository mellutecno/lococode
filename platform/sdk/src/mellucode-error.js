export class MelluCodeError extends Error {
  constructor(message, { status = 0, payload = null } = {}) {
    super(message);
    this.name = "MelluCodeError";
    this.status = status;
    this.payload = payload;
  }
}
