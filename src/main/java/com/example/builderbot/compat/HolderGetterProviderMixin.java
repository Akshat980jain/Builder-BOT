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
 * Intercepts missing elements in HolderGetter.Provider (Registry lookup / dynamic registry wrapper)
 * to prevent IllegalStateException: Missing element during configuration finish.
 */
@Mixin(HolderGetter.Provider.class)
public interface HolderGetterProviderMixin {

    @Inject(method = "getOrThrow", at = @At("HEAD"), cancellable = true)
    private <T> void builderbot$gracefulProviderMissingHolder(
        ResourceKey<T> key, CallbackInfoReturnable<Holder.Reference<T>> cir) {

        HolderGetter.Provider self = (HolderGetter.Provider) this;

        Optional<Holder.Reference<T>> found = self.get(key);
        if (found.isPresent()) {
            return;
        }

        BuilderBotMod.LOGGER.warn(
            "[BuilderBot Compat] (Provider) Missing dynamic registry element {} — the server doesn't have this modded content. Continuing without it instead of disconnecting.",
            key
        );

        @SuppressWarnings("unchecked")
        HolderOwner<T> owner = (self instanceof HolderOwner<?> ho) ? (HolderOwner<T>) ho : new HolderOwner<T>() {};
        try {
            cir.setReturnValue(Holder.Reference.createStandAlone(owner, key));
        } catch (Throwable t) {
            BuilderBotMod.LOGGER.error("[BuilderBot Compat] Failed to create standalone provider holder for {}: {}", key, t.getMessage());
        }
    }
}
