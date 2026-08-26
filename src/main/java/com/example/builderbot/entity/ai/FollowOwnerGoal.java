package com.example.builderbot.entity.ai;

import com.example.builderbot.entity.BuilderBotEntity;
import net.minecraft.core.BlockPos;
import net.minecraft.world.entity.ai.goal.Goal;
import net.minecraft.world.entity.player.Player;

import java.util.EnumSet;

public class FollowOwnerGoal extends Goal {

    private final BuilderBotEntity bot;
    private final double speed;
    private final float minDistance;
    private final float maxDistance;
    private Player owner;

    public FollowOwnerGoal(BuilderBotEntity bot, double speed, float maxDistance, float minDistance) {
        this.bot = bot;
        this.speed = speed;
        this.maxDistance = maxDistance;
        this.minDistance = minDistance;
        this.setFlags(EnumSet.of(Flag.MOVE, Flag.LOOK));
    }

    @Override
    public boolean canUse() {
        if (bot.getCurrentPlan() != null && !bot.getCurrentPlan().isEmpty()) {
            return false;
        }

        Player nearest = bot.level().getNearestPlayer(bot, maxDistance);
        if (nearest == null) return false;

        this.owner = nearest;
        return bot.distanceToSqr(owner) > (minDistance * minDistance);
    }

    @Override
    public boolean canContinueToUse() {
        return owner != null && owner.isAlive()
                && bot.distanceToSqr(owner) > (minDistance * minDistance)
                && (bot.getCurrentPlan() == null || bot.getCurrentPlan().isEmpty());
    }

    @Override
    public void start() {
        bot.getNavigation().moveTo(owner, speed);
    }

    @Override
    public void stop() {
        owner = null;
        bot.getNavigation().stop();
    }

    @Override
    public void tick() {
        if (owner == null) return;
        bot.getLookControl().setLookAt(owner, 10.0F, (float) bot.getMaxHeadXRot());

        if (bot.distanceToSqr(owner) > (maxDistance * maxDistance * 2)) {
            BlockPos targetPos = owner.blockPosition();
            bot.setPos(targetPos.getX() + 0.5, targetPos.getY(), targetPos.getZ() + 0.5);
        } else {
            bot.getNavigation().moveTo(owner, speed);
        }
    }
}
