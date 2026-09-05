package com.example.builderbot.build;

import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;

import java.util.ArrayList;
import java.util.List;

/**
 * Scans bounding boxes and generates top-to-bottom terrain clearing / excavation plans.
 */
public class ExcavationManager {

    private ExcavationManager() {}

    /**
     * Creates an excavation plan for a 3D box, clearing all non-air blocks from top to bottom.
     */
    public static BuildPlan createClearingPlan(ServerLevel world, BlockPos minPos, BlockPos maxPos) {
        int minX = Math.min(minPos.getX(), maxPos.getX());
        int maxX = Math.max(minPos.getX(), maxPos.getX());
        int minY = Math.min(minPos.getY(), maxPos.getY());
        int maxY = Math.max(minPos.getY(), maxPos.getY());
        int minZ = Math.min(minPos.getZ(), maxPos.getZ());
        int maxZ = Math.max(minPos.getZ(), maxPos.getZ());

        List<BuildTask> clearTasks = new ArrayList<>();
        BlockState airState = Blocks.AIR.defaultBlockState();

        for (int y = maxY; y >= minY; y--) {
            for (int x = minX; x <= maxX; x++) {
                for (int z = minZ; z <= maxZ; z++) {
                    BlockPos pos = new BlockPos(x, y, z);
                    BlockState current = world.getBlockState(pos);
                    if (!current.isAir()) {
                        clearTasks.add(new BuildTask(pos, airState));
                    }
                }
            }
        }

        return new BuildPlan(clearTasks);
    }
}
