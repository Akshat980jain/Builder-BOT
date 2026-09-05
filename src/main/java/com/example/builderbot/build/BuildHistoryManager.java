package com.example.builderbot.build;

import net.minecraft.core.BlockPos;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Tracks placed blocks across build sessions and provides reverse-demolition / undo plans.
 */
public class BuildHistoryManager {

    private static final Deque<List<BlockPos>> historyStack = new ArrayDeque<>();
    private static final Map<BlockPos, BlockState> previousBlockStates = new ConcurrentHashMap<>();

    private BuildHistoryManager() {}

    /**
     * Starts recording a new build session.
     */
    public static synchronized void recordPlacement(BlockPos pos, BlockState oldState) {
        if (historyStack.isEmpty()) {
            historyStack.push(new ArrayList<>());
        }
        historyStack.peek().add(pos);
        previousBlockStates.putIfAbsent(pos, oldState);
    }

    /**
     * Completes current build session so next build starts a new undo level.
     */
    public static synchronized void pushNewSession() {
        historyStack.push(new ArrayList<>());
    }

    /**
     * Generates a demolition/undo plan to revert the most recent build session.
     */
    public static synchronized BuildPlan createUndoPlan() {
        while (!historyStack.isEmpty() && historyStack.peek().isEmpty()) {
            historyStack.pop();
        }

        if (historyStack.isEmpty()) {
            return null;
        }

        List<BlockPos> lastSession = historyStack.pop();
        List<BuildTask> undoTasks = new ArrayList<>();

        // Demolish top-to-bottom
        for (BlockPos pos : lastSession) {
            BlockState revertState = previousBlockStates.getOrDefault(pos, Blocks.AIR.defaultBlockState());
            undoTasks.add(new BuildTask(pos, revertState));
            previousBlockStates.remove(pos);
        }

        // Sort top-to-bottom for clean demolition without falling block glitches
        undoTasks.sort((a, b) -> Integer.compare(b.pos().getY(), a.pos().getY()));

        return new BuildPlan(undoTasks);
    }

    public static synchronized boolean hasUndoHistory() {
        return !historyStack.isEmpty() && historyStack.stream().anyMatch(list -> !list.isEmpty());
    }

    public static synchronized void clearHistory() {
        historyStack.clear();
        previousBlockStates.clear();
    }
}
