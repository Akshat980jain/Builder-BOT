package com.example.builderbot.entity;

import com.example.builderbot.BuilderBotMod;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;

public class ModEntities {

    public static final ResourceKey<EntityType<?>> BUILDER_BOT_KEY = ResourceKey.create(
            Registries.ENTITY_TYPE,
            Identifier.fromNamespaceAndPath(BuilderBotMod.MOD_ID, "builder_bot")
    );

    public static final EntityType<BuilderBotEntity> BUILDER_BOT = Registry.register(
            BuiltInRegistries.ENTITY_TYPE,
            BUILDER_BOT_KEY,
            EntityType.Builder.<BuilderBotEntity>of(BuilderBotEntity::new, MobCategory.MISC)
                    .sized(0.6f, 1.95f)
                    .clientTrackingRange(10)
                    .updateInterval(3)
                    .build(BUILDER_BOT_KEY)
    );

    public static void register() {
        BuilderBotMod.LOGGER.debug("[BuilderBot] Entity types registered.");
    }
}
