// A forced primary failure for staging's live lane (M22.1): armed once by a chat's owner through the
// staging-only `/dev/model-fault` probe. The chat's engine is handed the `AI` binding through `wrap`,
// whose next universal request through the gateway (the chat route's OpenRouter primary; Workers AI
// legs never take that path) answers 503 without being sent, so the hedge serves that step. It lives
// in one chat instance's memory alone: nothing outside staging arms it and an eviction disarms it.
export class PrimaryFault {
  private armed = false;

  arm(): void {
    this.armed = true;
  }

  /** The binding with its gateway answering one 503 after `arm`; every other call passes through. */
  wrap(ai: Ai): Ai {
    return new Proxy(ai, {
      get: (target, prop, receiver) => {
        if (prop !== "gateway") {
          const value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return (id: string) => {
          const gateway = target.gateway(id);
          return {
            getLog: (logId: string) => gateway.getLog(logId),
            patchLog: (logId: string, data: AiGatewayPatchLog) => gateway.patchLog(logId, data),
            getUrl: (provider?: string) => gateway.getUrl(provider),
            run: async (...args: Parameters<AiGateway["run"]>) => {
              if (!this.armed) return gateway.run(...args);
              this.armed = false;
              return new Response(JSON.stringify({ error: { message: "a primary failure forced by the staging live lane" } }), { status: 503 });
            },
          };
        };
      },
    });
  }
}
