package com.example.builderbot.compat;

import com.example.builderbot.BuilderBotMod;
import net.minecraft.core.Holder;
import net.minecraft.core.HolderGetter;
import net.minecraft.core.HolderOwner;
import net.minecraft.resources.ResourceKey;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import java.util.Optional;

/**
 * Intercepts missing dynamic-registry elements (like custom jukebox_song discs from BetterEnd)
 * during the Configuration Phase so the client doesn't crash with Network Protocol Error.
 */
@Mixin(HolderGetter.class)
public interface HolderGetterMixin<T> {

    @Inject(method = "getOrThrow", at = @At("HEAD"), cancellable = true)
    private void builderbot$gracefulMissingHolder(
        ResourceKey<T> key, CallbackInfoReturnable<Holder.Reference<T>> cir) {

        @SuppressWarnings("unchecked")
        HolderGetter<T> self = (HolderGetter<T>) this;

        Optional<Holder.Reference<T>> found = self.get(key);
        if (found.isPresent()) {
            return;
        }

        BuilderBotMod.LOGGER.warn(
            "[BuilderBot Compat] Missing dynamic registry element {} — the server doesn't have this modded content. Continuing without it instead of disconnecting.",
            key
        );

        @SuppressWarnings("unchecked")
        HolderOwner<T> owner = (self instanceof HolderOwner<?> ho) ? (HolderOwner<T>) ho : new HolderOwner<T>() {};
        try {
            cir.setReturnValue(Holder.Reference.createStandAlone(owner, key));
        } catch (Throwable t) {
            BuilderBotMod.LOGGER.error("[BuilderBot Compat] Failed to create standalone holder for {}: {}", key, t.getMessage());
        }
    }
}
