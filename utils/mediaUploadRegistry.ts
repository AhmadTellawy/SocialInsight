class MediaUploadRegistry {
  private readonly controllers = new Map<string, AbortController>();

  create(clientId: string): AbortController {
    this.cancel(clientId);
    const controller = new AbortController();
    this.controllers.set(clientId, controller);
    return controller;
  }

  cancel(clientId: string): void {
    this.controllers.get(clientId)?.abort();
    this.controllers.delete(clientId);
  }

  isActive(clientId: string, controller: AbortController): boolean {
    return this.controllers.get(clientId) === controller && !controller.signal.aborted;
  }

  finish(clientId: string, controller: AbortController): void {
    if (this.controllers.get(clientId) === controller) this.controllers.delete(clientId);
  }
}

export const mediaUploadRegistry = new MediaUploadRegistry();
