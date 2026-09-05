package com.example.builderbot.build;

import java.util.Comparator;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * A thread-safe, shared ordered queue of {@link BuildTask}s supporting both single-bot
 * and multi-bot cooperative swarm construction.
 */
public class BuildPlan {

    private final Queue<BuildTask> queue;
    private final int totalCount;
    private final AtomicInteger remainingCount;

    public BuildPlan(List<BuildTask> tasks) {
        List<BuildTask> sorted = tasks.stream()
                .sorted(Comparator
                        .comparingInt((BuildTask t) -> t.pos().getY())
                        .thenComparingInt(t -> t.pos().getX())
                        .thenComparingInt(t -> t.pos().getZ()))
                .toList();
        this.queue = new ConcurrentLinkedQueue<>(sorted);
        this.totalCount = sorted.size();
        this.remainingCount = new AtomicInteger(sorted.size());
    }

    /** Returns {@code true} when all blocks have been placed. */
    public boolean isEmpty() {
        return queue.isEmpty();
    }

    /** Peek at the next task without removing it from the queue. */
    public BuildTask peek() {
        return queue.peek();
    }

    /**
     * Atomically consumes and returns the next task for a bot in the swarm.
     */
    public BuildTask poll() {
        BuildTask task = queue.poll();
        if (task != null) {
            remainingCount.decrementAndGet();
        }
        return task;
    }

    /** Number of blocks still to be placed. */
    public int remaining() {
        return Math.max(0, remainingCount.get());
    }

    /** Total number of blocks in this plan. */
    public int total() {
        return totalCount;
    }

    /** Percentage completion in [0, 100]. */
    public int percentComplete() {
        if (totalCount == 0) return 100;
        int placed = totalCount - remaining();
        return Math.min(100, Math.max(0, (int) ((placed / (double) totalCount) * 100)));
    }

    /** Returns a snapshot list of remaining tasks in this plan. */
    public List<BuildTask> getTasks() {
        return new java.util.ArrayList<>(queue);
    }
}
