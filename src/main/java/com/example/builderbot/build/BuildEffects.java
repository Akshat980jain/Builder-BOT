package com.example.builderbot.build;

import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.DustParticleOptions;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.projectile.FireworkRocketEntity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.phys.Vec3;

/**
 * Handles construction visual FX: particle laser beams and completion fireworks.
 */
public class BuildEffects {

    private static final DustParticleOptions GOLD_LASER_PARTICLE =
            new DustParticleOptions(0xF59E0B, 1.2F); // Amber Gold

    private static final DustParticleOptions CYAN_LASER_PARTICLE =
            new DustParticleOptions(0x38BDF8, 1.2F); // Sky Blue / Cyan

    private BuildEffects() {}

    /**
     * Spawns a laser spark beam from the bot's position to the target placement block.
     */
    public static void spawnLaserBeam(ServerLevel world, Vec3 botPos, BlockPos targetPos, boolean isUndo) {
        Vec3 start = botPos.add(0, 1.0, 0);
        Vec3 end = Vec3.atCenterOf(targetPos);
        Vec3 delta = end.subtract(start);
        double distance = delta.length();
        int stepCount = (int) Math.max(4, distance * 3.0);

        DustParticleOptions particle = isUndo ? CYAN_LASER_PARTICLE : GOLD_LASER_PARTICLE;

        for (int i = 0; i <= stepCount; i++) {
            double progress = (double) i / stepCount;
            double px = start.x + (delta.x * progress);
            double py = start.y + (delta.y * progress);
            double pz = start.z + (delta.z * progress);

            world.sendParticles(particle, px, py, pz, 1, 0.02, 0.02, 0.02, 0.0);
        }

        // Impact sparks at the target block
        world.sendParticles(ParticleTypes.ELECTRIC_SPARK, end.x, end.y, end.z, 5, 0.2, 0.2, 0.2, 0.05);
    }

    /**
     * Launches a celebratory firework rocket above the completed structure.
     */
    public static void spawnCelebrationFireworks(ServerLevel world, BlockPos centerPos) {
        ItemStack fireworkStack = new ItemStack(Items.FIREWORK_ROCKET);
        FireworkRocketEntity firework = new FireworkRocketEntity(
                world,
                centerPos.getX() + 0.5,
                centerPos.getY() + 3.0,
                centerPos.getZ() + 0.5,
                fireworkStack
        );
        world.addFreshEntity(firework);
    }
}
