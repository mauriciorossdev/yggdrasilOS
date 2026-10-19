import { definePlugin } from "@yggdrasil/sdk";
import { slackChannel } from "./slack.js";

const plugin = definePlugin({
  id: "channel-slack",
  name: "Slack Channel",
  version: "0.1.0",
  register(api) {
    api.registerChannel(slackChannel);
    api.logger.info("registered channel", { id: "slack" });
  },
});

export default plugin;
