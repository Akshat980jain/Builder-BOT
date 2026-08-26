package com.example.builderbot.entity;

import com.example.builderbot.build.BuildPlan;
import com.example.builderbot.entity.ai.BuildGoal;
import net.minecraft.network.syncher.EntityDataAccessor;
import net.minecraft.network.syncher.EntityDataSerializers;
import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.PathfinderMob;
import net.minecraft.world.entity.ai.attributes.AttributeSupplier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.ai.goal.FloatGoal;
import net.minecraft.world.entity.ai.goal.LookAtPlayerGoal;
import net.minecraft.world.entity.ai.goal.RandomLookAroundGoal;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.Level;
import org.jetbrains.annotations.Nullable;

/**
 * Immortal Builder Bot with creative flight capabilities and in-game GUI control.
 */
public class BuilderBotEntity extends PathfinderMob {

    private static final EntityDataAccessor<Boolean> FLYING =
            SynchedEntityData.defineId(BuilderBotEntity.class, EntityDataSerializers.BOOLEAN);

    private BuildPlan currentPlan = null;
    private BuildGoal buildGoal;

    public BuilderBotEntity(EntityType<? extends PathfinderMob> type, Level world) {
        super(type, world);
        this.setInvulnerable(true);
        this.setPersistenceRequired();

        if (!world.isClientSide()) {
            this.setItemSlot(EquipmentSlot.MAINHAND, new ItemStack(Items.DIAMOND_PICKAXE));
            this.setItemSlot(EquipmentSlot.HEAD, new ItemStack(Items.GOLDEN_HELMET)); // Yellow Construction Hard Hat
            this.setCustomName(net.minecraft.network.chat.Component.literal("👷 Builder Bot"));
            this.setCustomNameVisible(true);
        }
    }

    public static AttributeSupplier.Builder createAttributes() {
        return PathfinderMob.createMobAttributes()
                .add(Attributes.MAX_HEALTH, 100.0)
                .add(Attributes.MOVEMENT_SPEED, 0.45)
                .add(Attributes.FOLLOW_RANGE, 128.0);
    }

    @Override
    protected void defineSynchedData(SynchedEntityData.Builder builder) {
        super.defineSynchedData(builder);
        builder.define(FLYING, false);
    }

    @Override
    protected void registerGoals() {
        this.goalSelector.addGoal(0, new FloatGoal(this));
        this.buildGoal = new BuildGoal(this);
        this.goalSelector.addGoal(1, this.buildGoal);
        this.goalSelector.addGoal(2, new LookAtPlayerGoal(this, Player.class, 8.0f));
        this.goalSelector.addGoal(3, new RandomLookAroundGoal(this));
    }

    @Override
    public void tick() {
        super.tick();
        if (!this.level().isClientSide() && this.level() instanceof ServerLevel world) {
            com.example.builderbot.build.PreviewManager.tickPreview(world);
        }
    }

    // ── TOTAL IMMORTALITY & INVULNERABILITY ──────────────────────────────────

    @Override
    public boolean hurtServer(ServerLevel level, DamageSource source, float amount) {
        return false;
    }

    @Override
    public boolean isInvulnerableTo(ServerLevel level, DamageSource source) {
        return true;
    }

    @Override
    public boolean isDeadOrDying() {
        return false;
    }

    @Override
    public void die(DamageSource damageSource) {
        // Prevent death entirely
    }

    @Override
    public boolean removeWhenFarAway(double distanceToClosestPlayer) {
        return false;
    }

    @Override
    public boolean requiresCustomPersistence() {
        return true;
    }

    @Override
    public boolean causeFallDamage(double fallDistance, float damageMultiplier, DamageSource damageSource) {
        return false;
    }

    // ── FLIGHT MODE ──────────────────────────────────────────────────────────

    public boolean isFlying() {
        return this.entityData.get(FLYING);
    }

    public void setFlying(boolean flying) {
        this.entityData.set(FLYING, flying);
        this.setNoGravity(flying);
        if (flying) {
            this.setDeltaMovement(0, 0.05, 0);
        }
    }

    // ── RIGHT-CLICK INTERACTION ──────────────────────────────────────────────

    @Override
    public InteractionResult mobInteract(Player player, InteractionHand hand) {
        if (hand == InteractionHand.MAIN_HAND) {
            return InteractionResult.SUCCESS;
        }
        return super.mobInteract(player, hand);
    }

    // ── PLAN & SWARM MANAGEMENT ─────────────────────────────────────────────

    private int swarmIndex = 0;
    private int swarmTotal = 1;

    public void assignPlan(@Nullable BuildPlan plan) {
        this.currentPlan = plan;
    }

    @Nullable
    public BuildPlan getCurrentPlan() {
        return currentPlan;
    }

    public int getSwarmIndex() {
        return swarmIndex;
    }

    public void setSwarmIndex(int index) {
        this.swarmIndex = index;
    }

    public int getSwarmTotal() {
        return swarmTotal;
    }

    public void setSwarmTotal(int total) {
        this.swarmTotal = Math.max(1, total);
    }
}
