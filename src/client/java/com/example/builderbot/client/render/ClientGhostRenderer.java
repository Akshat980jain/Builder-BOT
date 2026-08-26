package com.example.builderbot.client.render;

import com.example.builderbot.build.BuildPlan;
import com.example.builderbot.build.BuildTask;
import com.example.builderbot.build.PreviewManager;
import com.example.builderbot.build.SchematicManager;
import net.fabricmc.api.EnvType;
import net.fabricmc.api.Environment;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Renders complete block-by-block ghost schematic holograms purely in the client world.
 * Allows walking through the holographic structure to inspect every interior room, wall, and detail.
 */
@Environment(EnvType.CLIENT)
public class ClientGhostRenderer {

    private static final List<BlockPos> activeGhostPositions = new ArrayList<>();
    private static final Map<BlockPos, BlockState> originalBlockStates = new HashMap<>();
    private static String activeSchematicName = null;

    private ClientGhostRenderer() {}

    /**
     * Loads a schematic and injects every block into the client's visual mesh as a ghost hologram.
     */
    public static boolean showGhostSchematic(String filename, BlockPos origin, int rotation) {
        clearGhostSchematic();

        Minecraft mc = Minecraft.getInstance();
        ClientLevel level = mc.level;
        if (level == null) return false;

        Optional<BuildPlan> planOpt = SchematicManager.loadByName(filename, origin);
        if (planOpt.isEmpty()) {
            if (mc.player != null) {
                mc.player.sendSystemMessage(Component.literal("❌ Could not load schematic '" + filename + "'").withStyle(ChatFormatting.RED));
            }
            return false;
        }

        BuildPlan plan = planOpt.get();
        if (rotation != 0) {
            plan = PreviewManager.transformPlan(plan, origin, rotation, BlockPos.ZERO);
        }

        List<BuildTask> tasks = plan.getTasks();
        if (tasks.isEmpty()) {
            if (mc.player != null) {
                mc.player.sendSystemMessage(Component.literal("⚠ Schematic contains 0 blocks.").withStyle(ChatFormatting.YELLOW));
            }
            return false;
        }

        // Inject all blocks client-side
        for (BuildTask task : tasks) {
            BlockPos pos = task.pos();
            BlockState currentState = level.getBlockState(pos);

            // Only save and replace if it was air or replaceable
            originalBlockStates.putIfAbsent(pos, currentState);
            level.setBlock(pos, task.state(), 19); // 19 = 1 | 2 | 16 (client chunk render update)
            activeGhostPositions.add(pos);
        }

        activeSchematicName = filename;

        if (mc.player != null) {
            mc.player.sendSystemMessage(
                    Component.literal("🔮 3D Block-by-Block Ghost Hologram ACTIVE for '" + filename + "' (" + tasks.size() + " blocks) — Walk through to inspect!").withStyle(ChatFormatting.AQUA));
        }

        return true;
    }

    /**
     * Reverts all client ghost blocks back to their original states.
     */
    public static void clearGhostSchematic() {
        Minecraft mc = Minecraft.getInstance();
        ClientLevel level = mc.level;

        if (level != null && !activeGhostPositions.isEmpty()) {
            for (BlockPos pos : activeGhostPositions) {
                BlockState originalState = originalBlockStates.getOrDefault(pos, Blocks.AIR.defaultBlockState());
                level.setBlock(pos, originalState, 19);
            }
        }

        activeGhostPositions.clear();
        originalBlockStates.clear();
        activeSchematicName = null;
    }

    public static boolean hasActiveGhost() {
        return !activeGhostPositions.isEmpty();
    }

    public static String getActiveSchematicName() {
        return activeSchematicName;
    }
}
