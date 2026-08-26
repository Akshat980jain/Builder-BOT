package com.example.builderbot.client;

import com.example.builderbot.BuilderBotMod;
import com.example.builderbot.client.gui.BuilderBotScreen;
import com.example.builderbot.entity.BuilderBotEntity;
import com.example.builderbot.entity.ModEntities;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.api.EnvType;
import net.fabricmc.api.Environment;
import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;
import net.fabricmc.fabric.api.event.player.UseEntityCallback;
import net.minecraft.client.Minecraft;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;

@Environment(EnvType.CLIENT)
public class BuilderBotClient implements ClientModInitializer {

    @Override
    public void onInitializeClient() {
        BuilderBotMod.LOGGER.info("[BuilderBot] Initialising client renderer & screen opener…");

        // 1. Entity Renderer
        EntityRendererRegistry.register(
                ModEntities.BUILDER_BOT,
                BuilderBotRenderer::new);

        // 2. Client-Side Right-Click Screen Opener
        UseEntityCallback.EVENT.register((player, world, hand, entity, hitResult) -> {
            if (entity instanceof BuilderBotEntity bot && hand == InteractionHand.MAIN_HAND) {
                if (world.isClientSide()) {
                    Minecraft.getInstance().execute(() -> {
                        Minecraft.getInstance().setScreenAndShow(new BuilderBotScreen(bot));
                    });
                    return InteractionResult.SUCCESS;
                }
            }
            return InteractionResult.PASS;
        });

        BuilderBotMod.LOGGER.info("[BuilderBot] Client ready.");
    }
}
