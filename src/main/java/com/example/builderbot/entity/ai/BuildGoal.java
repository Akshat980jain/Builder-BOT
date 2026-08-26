package com.example.builderbot.entity.ai;

import com.example.builderbot.build.BuildEffects;
import com.example.builderbot.build.BuildHistoryManager;
import com.example.builderbot.build.BuildPlan;
import com.example.builderbot.build.BuildTask;
import com.example.builderbot.entity.BuilderBotEntity;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.ai.goal.Goal;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;

import java.util.EnumSet;

public class BuildGoal extends Goal {

    private final BuilderBotEntity bot;
    private int placementCooldown = 0;
    private static final double MAX_CREATIVE_REACH_SQ = 144.0; // 12 blocks creative reach

    public BuildGoal(BuilderBotEntity bot) {
        this.bot = bot;
        this.setFlags(EnumSet.of(Flag.MOVE, Flag.LOOK));
    }

    @Override
    public boolean canUse() {
        BuildPlan plan = bot.getCurrentPlan();
        return plan != null && !plan.isEmpty();
    }

    @Override
    public boolean canContinueToUse() {
        return canUse();
    }

    @Override
    public void start() {
        bot.setFlying(true);
    }

    @Override
    public void stop() {
        bot.setFlying(false);
    }

    @Override
    public void tick() {
        BuildPlan plan = bot.getCurrentPlan();
        if (plan == null || plan.isEmpty()) {
            bot.setFlying(false);
            return;
        }

        BuildTask nextTask = plan.peek();
        if (nextTask == null) return;

        BlockPos targetPos = nextTask.pos();
        double targetCenterX = targetPos.getX() + 0.5;
        double targetCenterY = targetPos.getY() + 0.5;
        double targetCenterZ = targetPos.getZ() + 0.5;

        double distanceSq = bot.distanceToSqr(targetCenterX, targetCenterY, targetCenterZ);

        // Always face the block being built
        bot.getLookControl().setLookAt(targetCenterX, targetCenterY, targetCenterZ, 60.0F, 60.0F);

        // ── 3D RADIAL SWARM POSITIONING ──────────────────────────────────────
        int swarmIndex = bot.getSwarmIndex();
        int swarmTotal = bot.getSwarmTotal();
        double radialAngle = (2.0 * Math.PI * swarmIndex) / Math.max(1, swarmTotal);
        double vantageRadius = 3.5;

        double idealY = Math.max(targetPos.getY() + 0.5, bot.level().getMinY() + 1.0);
        double vantageX = targetCenterX + (Math.cos(radialAngle) * vantageRadius);
        double vantageZ = targetCenterZ + (Math.sin(radialAngle) * vantageRadius);
        Vec3 desiredPos = new Vec3(vantageX, idealY, vantageZ);

        bot.setFlying(true);
        Vec3 currentPos = bot.position();
        Vec3 delta = desiredPos.subtract(currentPos);
        double moveDist = delta.length();

        if (moveDist > 0.3) {
            double speed = Math.min(0.5, moveDist * 0.35);
            Vec3 velocity = delta.normalize().scale(speed);
            bot.setDeltaMovement(velocity);
        }

        // Failsafe snap
        if (distanceSq > 400.0) {
            bot.teleportTo(vantageX, idealY, vantageZ);
        }

        if (distanceSq > MAX_CREATIVE_REACH_SQ) {
            return;
        }

        // ── BLOCK PLACEMENT & VISUAL FX ──────────────────────────────────────
        if (placementCooldown > 0) {
            placementCooldown--;
            return;
        }

        BuildTask taskToPlace = plan.poll();
        if (taskToPlace == null) return;

        if (bot.level() instanceof ServerLevel world) {
            BlockPos pos = taskToPlace.pos();
            BlockState stateToPlace = taskToPlace.state();
            BlockState previousState = world.getBlockState(pos);

            // Record into Undo History
            BuildHistoryManager.recordPlacement(pos, previousState);

            // Place block
            world.setBlock(pos, stateToPlace, 3);

            // Sound and arm swing
            world.playSound(
                    null,
                    pos,
                    stateToPlace.getSoundType().getPlaceSound(),
                    SoundSource.BLOCKS,
                    1.0F, 1.0F
            );
            bot.swing(InteractionHand.MAIN_HAND);

            // Emit Glowing Laser Particle Beam
            BuildEffects.spawnLaserBeam(world, bot.position(), pos, stateToPlace.isAir());

            // 100% Completion Fireworks Celebration
            if (plan.remaining() == 0) {
                BuildEffects.spawnCelebrationFireworks(world, pos);
            }
        }

        placementCooldown = 2;
    }
}
