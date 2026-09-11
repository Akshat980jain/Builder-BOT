package com.example.builderbot.build;

import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.DustParticleOptions;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.Rotation;
import net.minecraft.world.level.block.state.BlockState;

import java.util.ArrayList;
import java.util.List;

/**
 * Manages continuous active in-world holographic projections, blueprint preview state,
 * rotation transformations, and dense boundary particle beams.
 */
public class PreviewManager {

    private static final DustParticleOptions HOLO_PARTICLE_CYAN =
            new DustParticleOptions(0x00F0FF, 1.4F); // High-intensity Neon Cyan

    private static final DustParticleOptions HOLO_PARTICLE_GOLD =
            new DustParticleOptions(0xF59E0B, 1.4F); // Vibrant Amber Gold

    public static class PreviewSession {
        public final BlockPos minPos;
        public final BlockPos maxPos;
        public final String name;
        public final int rotation;
        public int remainingTicks;

        public PreviewSession(BlockPos minPos, BlockPos maxPos, String name, int rotation, int durationTicks) {
            this.minPos = minPos;
            this.maxPos = maxPos;
            this.name = name;
            this.rotation = rotation;
            this.remainingTicks = durationTicks;
        }
    }

    private static PreviewSession activeSession = null;
    private static int tickCounter = 0;

    private PreviewManager() {}

    /**
     * Starts a continuous, persistent 60-second in-world hologram preview.
     */
    public static synchronized void startPreview(ServerLevel world, BlockPos minPos, BlockPos maxPos, String name, int rotation) {
        activeSession = new PreviewSession(minPos, maxPos, name, rotation, 1200); // 60 seconds (1200 ticks)
        renderHolographicBox(world, minPos, maxPos, rotation);
    }

    /**
     * Clears the current active hologram.
     */
    public static synchronized void clearPreview() {
        activeSession = null;
    }

    public static synchronized boolean hasActivePreview() {
        return activeSession != null && activeSession.remainingTicks > 0;
    }

    public static synchronized PreviewSession getActiveSession() {
        return activeSession;
    }

    /**
     * Ticked continuously by BuilderBotEntity or server world loop.
     */
    public static synchronized void tickPreview(ServerLevel world) {
        if (activeSession == null) return;

        activeSession.remainingTicks--;
        if (activeSession.remainingTicks <= 0) {
            activeSession = null;
            return;
        }

        tickCounter++;
        // Render dense glowing particles every 3 ticks (~6.6 times/sec) for a persistent hologram
        if (tickCounter % 3 == 0) {
            renderHolographicBox(world, activeSession.minPos, activeSession.maxPos, activeSession.rotation);
        }
    }

    /**
     * Applies rotation and offset to a list of build tasks.
     */
    public static BuildPlan transformPlan(BuildPlan originalPlan, BlockPos origin, int rotationDegrees, BlockPos offset) {
        if (originalPlan == null) return null;

        List<BuildTask> transformed = new ArrayList<>();
        Rotation rot = switch (rotationDegrees % 360) {
            case 90, -270 -> Rotation.CLOCKWISE_90;
            case 180, -180 -> Rotation.CLOCKWISE_180;
            case 270, -90 -> Rotation.COUNTERCLOCKWISE_90;
            default -> Rotation.NONE;
        };

        int minRotX = Integer.MAX_VALUE;
        int minRotY = Integer.MAX_VALUE;
        int minRotZ = Integer.MAX_VALUE;

        // Pass 1: rotate and find minimum rotated bounds
        List<BlockPos> rotatedPositions = new ArrayList<>(originalPlan.getTasks().size());
        for (BuildTask task : originalPlan.getTasks()) {
            BlockPos rel = task.pos().subtract(origin);
            int rx = rel.getX();
            int rz = rel.getZ();

            int newX = switch (rot) {
                case CLOCKWISE_90 -> -rz;
                case CLOCKWISE_180 -> -rx;
                case COUNTERCLOCKWISE_90 -> rz;
                default -> rx;
            };

            int newZ = switch (rot) {
                case CLOCKWISE_90 -> rx;
                case CLOCKWISE_180 -> -rz;
                case COUNTERCLOCKWISE_90 -> -rx;
                default -> rz;
            };

            rotatedPositions.add(new BlockPos(newX, rel.getY(), newZ));
            if (newX < minRotX) minRotX = newX;
            if (rel.getY() < minRotY) minRotY = rel.getY();
            if (newZ < minRotZ) minRotZ = newZ;
        }

        // Pass 2: Re-normalize so rotated bounding box starts at (0, 0, 0) relative to origin
        List<BuildTask> tasks = originalPlan.getTasks();
        for (int i = 0; i < tasks.size(); i++) {
            BuildTask task = tasks.get(i);
            BlockPos rPos = rotatedPositions.get(i);
            BlockPos finalPos = origin.offset(rPos.getX() - minRotX, rPos.getY() - minRotY, rPos.getZ() - minRotZ).offset(offset);
            BlockState rotatedState = task.state().rotate(rot);
            transformed.add(new BuildTask(finalPos, rotatedState));
        }

        // Sort bottom-to-top (Y ascending, then Z, then X)
        transformed.sort((a, b) -> {
            int cmpY = Integer.compare(a.pos().getY(), b.pos().getY());
            if (cmpY != 0) return cmpY;
            int cmpZ = Integer.compare(a.pos().getZ(), b.pos().getZ());
            if (cmpZ != 0) return cmpZ;
            return Integer.compare(a.pos().getX(), b.pos().getX());
        });

        // Re-align so the first placed task block remains exactly at origin (X, Y, Z)
        if (!transformed.isEmpty()) {
            BlockPos firstPos = transformed.get(0).pos();
            int dx = origin.getX() - firstPos.getX();
            int dy = origin.getY() - firstPos.getY();
            int dz = origin.getZ() - firstPos.getZ();
            if (dx != 0 || dy != 0 || dz != 0) {
                List<BuildTask> aligned = new ArrayList<>(transformed.size());
                for (BuildTask t : transformed) {
                    aligned.add(new BuildTask(t.pos().offset(dx, dy, dz), t.state()));
                }
                transformed = aligned;
            }
        }

        return new BuildPlan(transformed);
    }

    /**
     * Renders a dense, glowing 3D holographic wireframe box and orientation beacon directly in the world.
     */
    public static void renderHolographicBox(ServerLevel world, BlockPos minPos, BlockPos maxPos, int rotation) {
        double minX = Math.min(minPos.getX(), maxPos.getX());
        double maxX = Math.max(minPos.getX(), maxPos.getX()) + 1.0;
        double minY = Math.min(minPos.getY(), maxPos.getY());
        double maxY = Math.max(minPos.getY(), maxPos.getY()) + 1.0;
        double minZ = Math.min(minPos.getZ(), maxPos.getZ());
        double maxZ = Math.max(minPos.getZ(), maxPos.getZ()) + 1.0;

        // 1. Bottom Ground Frame (Cyan)
        drawParticleLine(world, minX, minY, minZ, maxX, minY, minZ, HOLO_PARTICLE_CYAN);
        drawParticleLine(world, minX, minY, maxZ, maxX, minY, maxZ, HOLO_PARTICLE_CYAN);
        drawParticleLine(world, minX, minY, minZ, minX, minY, maxZ, HOLO_PARTICLE_CYAN);
        drawParticleLine(world, maxX, minY, minZ, maxX, minY, maxZ, HOLO_PARTICLE_CYAN);

        // 2. Top Roof Frame (Gold)
        drawParticleLine(world, minX, maxY, minZ, maxX, maxY, minZ, HOLO_PARTICLE_GOLD);
        drawParticleLine(world, minX, maxY, maxZ, maxX, maxY, maxZ, HOLO_PARTICLE_GOLD);
        drawParticleLine(world, minX, maxY, minZ, minX, maxY, maxZ, HOLO_PARTICLE_GOLD);
        drawParticleLine(world, maxX, maxY, minZ, maxX, maxY, maxZ, HOLO_PARTICLE_GOLD);

        // 3. Vertical Corner Pillars (Cyan + End Rod sparkles)
        drawParticleLine(world, minX, minY, minZ, minX, maxY, minZ, HOLO_PARTICLE_CYAN);
        drawParticleLine(world, maxX, minY, minZ, maxX, maxY, minZ, HOLO_PARTICLE_CYAN);
        drawParticleLine(world, minX, minY, maxZ, minX, maxY, maxZ, HOLO_PARTICLE_CYAN);
        drawParticleLine(world, maxX, minY, maxZ, maxX, maxY, maxZ, HOLO_PARTICLE_CYAN);

        // 4. Glowing 8 Corner Beacons
        world.sendParticles(ParticleTypes.END_ROD, minX, minY, minZ, 2, 0.05, 0.05, 0.05, 0.01);
        world.sendParticles(ParticleTypes.END_ROD, maxX, minY, minZ, 2, 0.05, 0.05, 0.05, 0.01);
        world.sendParticles(ParticleTypes.END_ROD, minX, minY, maxZ, 2, 0.05, 0.05, 0.05, 0.01);
        world.sendParticles(ParticleTypes.END_ROD, maxX, minY, maxZ, 2, 0.05, 0.05, 0.05, 0.01);
        world.sendParticles(ParticleTypes.END_ROD, minX, maxY, minZ, 2, 0.05, 0.05, 0.05, 0.01);
        world.sendParticles(ParticleTypes.END_ROD, maxX, maxY, minZ, 2, 0.05, 0.05, 0.05, 0.01);
        world.sendParticles(ParticleTypes.END_ROD, minX, maxY, maxZ, 2, 0.05, 0.05, 0.05, 0.01);
        world.sendParticles(ParticleTypes.END_ROD, maxX, maxY, maxZ, 2, 0.05, 0.05, 0.05, 0.01);

        // 5. Center Ground Beacon (Shows middle of build)
        double centerX = (minX + maxX) / 2.0;
        double centerZ = (minZ + maxZ) / 2.0;
        world.sendParticles(ParticleTypes.GLOW, centerX, minY + 0.2, centerZ, 4, 0.3, 0.1, 0.3, 0.01);
    }

    private static void drawParticleLine(ServerLevel world, double x1, double y1, double z1, double x2, double y2, double z2, DustParticleOptions particle) {
        double dx = x2 - x1;
        double dy = y2 - y1;
        double dz = z2 - z1;
        double length = Math.sqrt(dx * dx + dy * dy + dz * dz);
        int steps = (int) Math.max(4, length * 2.5);

        for (int i = 0; i <= steps; i++) {
            double p = (double) i / steps;
            world.sendParticles(particle, x1 + (dx * p), y1 + (dy * p), z1 + (dz * p), 1, 0, 0, 0, 0);
        }
    }
}
