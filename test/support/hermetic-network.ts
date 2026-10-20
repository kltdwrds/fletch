// The hermetic lane's network: upstream's interceptor with no handler and no loopback, so every
// outbound fetch a test does not answer throws. hermetic.setup.ts installs it for each test file and
// asserts in afterAll that nothing escaped. A test that provokes an unmatched request on purpose takes
// its own entry back with `hermeticNetwork.takeUnmockedCalls(substring)`.
import { NetworkInterceptor } from "./network-interceptor.ts";

export const hermeticNetwork = new NetworkInterceptor({ allowLoopback: false });
