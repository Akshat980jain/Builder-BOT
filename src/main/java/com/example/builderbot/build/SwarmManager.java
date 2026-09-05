package com.example.builderbot.build;

import com.example.builderbot.BuilderBotMod;
import com.example.builderbot.entity.BuilderBotEntity;
import com.example.builderbot.entity.ModEntities;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayList;
import java.util.List;

/**
 * Coordinates and manages multi-bot cooperative construction swarms.
 */
public class SwarmManager {

    private SwarmManager() {}

    /**
     * Finds nearby bots and auto-spawns additional bots up to `targetBotCount`,
     * then assigns the shared BuildPlan to all of them with radial swarm indices.
     */
    public static List<BuilderBotEntity> deploySwarm(ServerLevel world,
                                                     Vec3 centerPos,
                                                     int targetBotCount,
                                                     BuildPlan plan) {
        int count = Math.max(1, Math.min(10, targetBotCount));

        // 1. Find existing bots in 64-block radius
        AABB searchBox = new AABB(
                centerPos.x - 64, centerPos.y - 32, centerPos.z - 64,
                centerPos.x + 64, centerPos.y + 32, centerPos.z + 64);

        List<BuilderBotEntity> existing = world.getEntitiesOfClass(BuilderBotEntity.class, searchBox, e -> true);
        List<BuilderBotEntity> swarmBots = new ArrayList<>(existing);

        // 2. Auto-spawn additional bots if more are needed
        int needed = count - swarmBots.size();
        for (int i = 0; i < needed; i++) {
            BuilderBotEntity newBot = ModEntities.BUILDER_BOT.create(world, EntitySpawnReason.COMMAND);
            if (newBot != null) {
                // Offset spawn positions in a circle around the center
                double angle = (2 * Math.PI * i) / Math.max(1, needed);
                double spawnX = centerPos.x + (Math.cos(angle) * 3.0);
                double spawnZ = centerPos.z + (Math.sin(angle) * 3.0);
                newBot.setPos(spawnX, centerPos.y, spawnZ);
                world.addFreshEntity(newBot);
                swarmBots.add(newBot);
            }
        }

        // Limit to requested count
        if (swarmBots.size() > count) {
            swarmBots = new ArrayList<>(swarmBots.subList(0, count));
        }

        int totalBots = swarmBots.size();

        // 3. Assign shared plan, flight mode, and swarm coordinates to each bot
        for (int i = 0; i < totalBots; i++) {
            BuilderBotEntity bot = swarmBots.get(i);
            bot.setSwarmIndex(i);
            bot.setSwarmTotal(totalBots);
            bot.setFlying(true);
            bot.assignPlan(plan);
        }

        BuilderBotMod.LOGGER.info("[BuilderBot] Deployed swarm of {} bots for construction plan ({} total blocks)",
                totalBots, plan.total());

        return swarmBots;
    }

    /**
     * Halts all Builder Bots in the specified radius.
     */
    public static int stopAll(ServerLevel world, Vec3 centerPos, double radius) {
        AABB searchBox = new AABB(
                centerPos.x - radius, centerPos.y - radius, centerPos.z - radius,
                centerPos.x + radius, centerPos.y + radius, centerPos.z + radius);

        List<BuilderBotEntity> bots = world.getEntitiesOfClass(BuilderBotEntity.class, searchBox, e -> true);
        for (BuilderBotEntity bot : bots) {
            bot.assignPlan(null);
            bot.setFlying(false);
        }
        return bots.size();
    }

    /**
     * Despawns all Builder Bots in the specified radius.
     */
    public static int despawnAll(ServerLevel world, Vec3 centerPos, double radius) {
        AABB searchBox = new AABB(
                centerPos.x - radius, centerPos.y - radius, centerPos.z - radius,
                centerPos.x + radius, centerPos.y + radius, centerPos.z + radius);

        List<BuilderBotEntity> bots = world.getEntitiesOfClass(BuilderBotEntity.class, searchBox, e -> true);
        for (BuilderBotEntity bot : bots) {
            bot.discard();
        }
        return bots.size();
    }
}
