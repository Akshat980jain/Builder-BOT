package com.example.builderbot.client;

import com.example.builderbot.BuilderBotMod;
import com.example.builderbot.client.gui.BuilderBotScreen;
import com.example.builderbot.client.gui.MinerBotScreen;
import com.example.builderbot.entity.BuilderBotEntity;
import com.example.builderbot.entity.ModEntities;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.api.EnvType;
import net.fabricmc.api.Environment;
import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;
import net.fabricmc.fabric.api.event.player.AttackEntityCallback;
import net.fabricmc.fabric.api.event.player.UseEntityCallback;
import net.minecraft.client.Minecraft;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.Entity;

@Environment(EnvType.CLIENT)
public class BuilderBotClient implements ClientModInitializer {

    public static String liveBuildStatus = null;
    public static long lastStatusUpdate = 0;

    @Override
    public void onInitializeClient() {
        BuilderBotMod.LOGGER.info("[BuilderBot & MinerBot] Initialising client renderer, punch & right-click interaction screens…");

        // 1. Entity Renderer
        EntityRendererRegistry.register(
                ModEntities.BUILDER_BOT,
                BuilderBotRenderer::new);

        // 2. Client-Side Right-Click Screen Opener (Use Entity Callback)
        UseEntityCallback.EVENT.register((player, world, hand, entity, hitResult) -> {
            if (entity != null && world.isClientSide()) {
                if (handleBotInteraction(entity)) {
                    return InteractionResult.SUCCESS;
                }
            }
            return InteractionResult.PASS;
        });

        // 3. Client-Side Left-Click / Punch Screen Opener (Attack Entity Callback)
        AttackEntityCallback.EVENT.register((player, world, hand, entity, hitResult) -> {
            if (entity != null && world.isClientSide()) {
                if (handleBotInteraction(entity)) {
                    return InteractionResult.SUCCESS;
                }
            }
            return InteractionResult.PASS;
        });

        // 4. Automated Creative Mode: Automatically ensure creative mode when a BuilderBot enters the world
        net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientEntityEvents.ENTITY_LOAD.register((entity, world) -> {
            if (entity != null && isBuilderBot(entity)) {
                String name = entity.getName() != null ? entity.getName().getString() : "";
                if (name.startsWith("BuilderBot") && Minecraft.getInstance().player != null && Minecraft.getInstance().player.connection != null) {
                    Minecraft.getInstance().player.connection.sendCommand("gamemode creative " + name);
                }
            }
        });

        // 5. Live Swarm Status Listener: Track progress from chat for GUI status card
        net.fabricmc.fabric.api.client.message.v1.ClientReceiveMessageEvents.GAME.register((message, overlay) -> {
            if (message != null) {
                String str = message.getString();
                if (str.contains("[Progress]") || str.contains("[Builder] Building")) {
                    if (str.contains(": ") && str.contains(" placed")) {
                        try {
                            int colon = str.indexOf(": ");
                            int placedIdx = str.indexOf(" placed");
                            String countStr = str.substring(colon + 2, placedIdx).trim();
                            String percentStr = "";
                            if (str.contains("- ") && str.contains("%)")) {
                                percentStr = str.substring(str.indexOf("- ") + 2, str.indexOf("%)") + 1);
                            }
                            liveBuildStatus = "🔨 " + countStr + " (" + percentStr + ")";
                            lastStatusUpdate = System.currentTimeMillis();
                        } catch (Exception ignored) {
                            liveBuildStatus = "🔨 Building...";
                            lastStatusUpdate = System.currentTimeMillis();
                        }
                    } else {
                        liveBuildStatus = "🔨 Building...";
                        lastStatusUpdate = System.currentTimeMillis();
                    }
                } else if (str.contains("[Builder] Done") || str.contains("[Builder] Build stopped") || str.contains("[Stop] Build stopped")) {
                    liveBuildStatus = null;
                }
            }
        });

        BuilderBotMod.LOGGER.info("[BuilderBot & MinerBot] Punch, Right-click & Live Status ready.");
    }

    private static boolean handleBotInteraction(Entity entity) {
        if (isMinerBot(entity)) {
            String botName = entity.getName() != null ? entity.getName().getString() : "Miner_Bot";
            BuilderBotMod.LOGGER.info("[MinerBot] Opening MinerBotScreen for: " + botName);
            Minecraft.getInstance().execute(() -> {
                Minecraft.getInstance().setScreenAndShow(new MinerBotScreen(botName));
            });
            return true;
        }

        if (isBuilderBot(entity)) {
            BuilderBotMod.LOGGER.info("[BuilderBot] Opening BuilderBotScreen for: " + entity.getName().getString());
            BuilderBotScreen.ensureBotsInCreative();
            Minecraft.getInstance().execute(() -> {
                Minecraft.getInstance().setScreenAndShow(new BuilderBotScreen(entity));
            });
            return true;
        }

        return false;
    }

    private static boolean isMinerBot(Entity entity) {
        if (entity == null) return false;
        String name = entity.getName() != null ? entity.getName().getString().toLowerCase() : "";
        String disp = entity.getDisplayName() != null ? entity.getDisplayName().getString().toLowerCase() : "";
        String score = entity.getScoreboardName() != null ? entity.getScoreboardName().toLowerCase() : "";
        String custom = entity.getCustomName() != null ? entity.getCustomName().getString().toLowerCase() : "";
        return name.contains("miner") || disp.contains("miner") || score.contains("miner") || custom.contains("miner");
    }

    private static boolean isBuilderBot(Entity entity) {
        if (entity == null) return false;
        if (entity instanceof BuilderBotEntity) return true;
        String name = entity.getName() != null ? entity.getName().getString().toLowerCase() : "";
        String disp = entity.getDisplayName() != null ? entity.getDisplayName().getString().toLowerCase() : "";
        String score = entity.getScoreboardName() != null ? entity.getScoreboardName().toLowerCase() : "";
        String custom = entity.getCustomName() != null ? entity.getCustomName().getString().toLowerCase() : "";
        return name.contains("builder") || disp.contains("builder") || score.contains("builder") || custom.contains("builder");
    }
}
