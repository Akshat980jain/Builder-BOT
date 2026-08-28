package com.example.builderbot.client;

import com.example.builderbot.BuilderBotMod;
import com.example.builderbot.client.gui.BuilderBotScreen;
import com.example.builderbot.entity.BuilderBotEntity;
import com.example.builderbot.entity.ModEntities;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.api.EnvType;
import net.fabricmc.api.Environment;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;
import net.fabricmc.fabric.api.event.player.UseEntityCallback;
import net.minecraft.client.Minecraft;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import org.lwjgl.glfw.GLFW;

@Environment(EnvType.CLIENT)
public class BuilderBotClient implements ClientModInitializer {

    private static boolean wasBDown = false;

    @Override
    public void onInitializeClient() {
        BuilderBotMod.LOGGER.info("[BuilderBot] Initialising client renderer, hotkeys & screen opener…");

        // 1. Entity Renderer
        EntityRendererRegistry.register(
                ModEntities.BUILDER_BOT,
                BuilderBotRenderer::new);

        // 2. Hotkey Detection (Press B to open Builder Bot Control Panel)
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            if (client.player != null && client.getWindow() != null) {
                long window = client.getWindow().handle();
                boolean isBDown = GLFW.glfwGetKey(window, GLFW.GLFW_KEY_B) == GLFW.GLFW_PRESS;
                if (isBDown && !wasBDown) {
                    client.setScreenAndShow(new BuilderBotScreen(null));
                }
                wasBDown = isBDown;
            }
        });

        // 3. Client-Side Right-Click Screen Opener (Works for BuilderBotEntity & named players)
        UseEntityCallback.EVENT.register((player, world, hand, entity, hitResult) -> {
            if (hand == InteractionHand.MAIN_HAND && world.isClientSide()) {
                boolean isBot = entity instanceof BuilderBotEntity;
                if (!isBot && entity != null) {
                    String name = entity.getName().getString();
                    if ("BuilderBot".equalsIgnoreCase(name) || "Builder Bot".equalsIgnoreCase(name) || name.contains("BuilderBot")) {
                        isBot = true;
                    }
                }
                if (isBot) {
                    BuilderBotEntity botEntity = (entity instanceof BuilderBotEntity b) ? b : null;
                    Minecraft.getInstance().execute(() -> {
                        Minecraft.getInstance().setScreenAndShow(new BuilderBotScreen(botEntity));
                    });
                    return InteractionResult.SUCCESS;
                }
            }
            return InteractionResult.PASS;
        });

        BuilderBotMod.LOGGER.info("[BuilderBot] Client ready.");
    }
}
