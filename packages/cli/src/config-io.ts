import {
  readConfigFile as readConfigFileCore,
  writeConfigFile as writeConfigFileCore,
  uniqueStrings,
  type YggdrasilConfig,
} from "@yggdrasil/config";

export { uniqueStrings };

export async function readConfigFile(workspaceRoot: string): Promise<{
  config: YggdrasilConfig;
  exists: boolean;
  path: string;
}> {
  return readConfigFileCore(workspaceRoot);
}

export async function writeConfigFile(
  workspaceRoot: string,
  partial: Partial<YggdrasilConfig>,
): Promise<string> {
  return writeConfigFileCore(workspaceRoot, partial);
}
