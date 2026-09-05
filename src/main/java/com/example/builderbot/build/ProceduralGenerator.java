package com.example.builderbot.build;

import net.minecraft.core.BlockPos;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;

import java.util.ArrayList;
import java.util.List;

/**
 * Procedurally generates mathematical architectural structures
 * (Pyramids, Domes/Spheres, Castle Towers, Spiral Stairs).
 */
public class ProceduralGenerator {

    private ProceduralGenerator() {}

    /**
     * Generates a stepped Egyptian-style Pyramid.
     */
    public static BuildPlan generatePyramid(BlockPos origin, int baseSize, BlockState state, boolean hollow) {
        List<BuildTask> tasks = new ArrayList<>();
        int currentSize = baseSize;
        int currentY = 0;

        while (currentSize > 0) {
            int offset = (baseSize - currentSize) / 2;
            for (int x = 0; x < currentSize; x++) {
                for (int z = 0; z < currentSize; z++) {
                    boolean isBorder = (x == 0 || x == currentSize - 1 || z == 0 || z == currentSize - 1);
                    if (!hollow || isBorder || currentSize <= 2) {
                        BlockPos pos = origin.offset(offset + x, currentY, offset + z);
                        tasks.add(new BuildTask(pos, state));
                    }
                }
            }
            currentSize -= 2;
            currentY++;
        }

        return new BuildPlan(tasks);
    }

    /**
     * Generates a Geodesic Dome (Half-Sphere) or Full Sphere.
     */
    public static BuildPlan generateDome(BlockPos origin, int radius, BlockState state, boolean hollow, boolean fullSphere) {
        List<BuildTask> tasks = new ArrayList<>();
        int minY = fullSphere ? -radius : 0;
        int maxY = radius;
        double radiusSq = radius * radius;
        double innerRadiusSq = (radius - 1.0) * (radius - 1.0);

        for (int y = minY; y <= maxY; y++) {
            for (int x = -radius; x <= radius; x++) {
                for (int z = -radius; z <= radius; z++) {
                    double distSq = (x * x) + (y * y) + (z * z);
                    if (distSq <= radiusSq) {
                        if (!hollow || distSq >= innerRadiusSq) {
                            BlockPos pos = origin.offset(x, y + (fullSphere ? radius : 0), z);
                            tasks.add(new BuildTask(pos, state));
                        }
                    }
                }
            }
        }

        return new BuildPlan(tasks);
    }

    /**
     * Generates a Medieval Castle Watchtower with battlements and crenellations.
     */
    public static BuildPlan generateCastleTower(BlockPos origin, int radius, int height, BlockState wallState, BlockState floorState) {
        List<BuildTask> tasks = new ArrayList<>();
        double radiusSq = radius * radius;
        double innerRadiusSq = Math.max(0, (radius - 1.0) * (radius - 1.0));

        for (int y = 0; y < height; y++) {
            boolean isTopRoof = (y == height - 1);
            boolean isFloor = (y == 0 || y % 6 == 0 || isTopRoof);

            for (int x = -radius; x <= radius; x++) {
                for (int z = -radius; z <= radius; z++) {
                    double distSq = (x * x) + (z * z);
                    if (distSq <= radiusSq) {
                        BlockPos pos = origin.offset(x, y, z);
                        if (isFloor) {
                            tasks.add(new BuildTask(pos, floorState));
                        } else if (distSq >= innerRadiusSq) {
                            // Wall ring with arrow slits on alternating heights
                            if (y % 3 != 0 || (x != 0 && z != 0)) {
                                tasks.add(new BuildTask(pos, wallState));
                            }
                        }
                    }
                }
            }
        }

        // Add Battlements / Crenellations on the roof rim (height)
        int crenelY = height;
        for (int x = -radius; x <= radius; x++) {
            for (int z = -radius; z <= radius; z++) {
                double distSq = (x * x) + (z * z);
                if (distSq <= radiusSq && distSq >= innerRadiusSq) {
                    if ((Math.abs(x) + Math.abs(z)) % 2 == 0) {
                        BlockPos pos = origin.offset(x, crenelY, z);
                        tasks.add(new BuildTask(pos, wallState));
                    }
                }
            }
        }

        return new BuildPlan(tasks);
    }

    /**
     * Generates an aesthetic Spiral Staircase.
     */
    public static BuildPlan generateSpiralStairs(BlockPos origin, int radius, int height, BlockState stepState, BlockState centerPillarState) {
        List<BuildTask> tasks = new ArrayList<>();

        // Center Pillar
        for (int y = 0; y < height; y++) {
            tasks.add(new BuildTask(origin.offset(0, y, 0), centerPillarState));
        }

        // Spiral Steps (45 degrees per Y-level)
        for (int y = 0; y < height; y++) {
            double angle = (y * Math.PI) / 4.0; // 45 deg per step
            for (int r = 1; r <= radius; r++) {
                int x = (int) Math.round(Math.cos(angle) * r);
                int z = (int) Math.round(Math.sin(angle) * r);
                tasks.add(new BuildTask(origin.offset(x, y, z), stepState));
            }
        }

        return new BuildPlan(tasks);
    }
}
