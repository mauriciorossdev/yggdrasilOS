import { definePlugin } from "@yggdrasil/sdk";
import { discordChannel } from "./discord.js";

const plugin = definePlugin({
  id: "channel-discord",
  name: "Discord Channel",
  version: "0.1.0",
  register(api) {
    api.registerChannel(discordChannel);
    api.logger.info("registered channel", { id: "discord" });
  },
});

export default plugin;
