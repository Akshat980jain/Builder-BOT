package com.example.builderbot;

import com.example.builderbot.command.BuilderBotCommands;
import com.example.builderbot.entity.BuilderBotEntity;
import com.example.builderbot.entity.ModEntities;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.object.builder.v1.entity.FabricDefaultAttributeRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Main server-side entrypoint for the Builder Bot mod.
 */
public class BuilderBotMod implements ModInitializer {

    public static final String MOD_ID = "builderbot";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitialize() {
        LOGGER.info("[BuilderBot] Initialising server components…");

        // 1. Entity type registry
        ModEntities.register();

        // 2. Attribute registration
        FabricDefaultAttributeRegistry.register(
                ModEntities.BUILDER_BOT,
                BuilderBotEntity.createAttributes());

        // 3. Server Commands
        CommandRegistrationCallback.EVENT.register(
                (dispatcher, registryAccess, environment) ->
                        BuilderBotCommands.register(dispatcher));

        LOGGER.info("[BuilderBot] Server components ready.");
    }
}
