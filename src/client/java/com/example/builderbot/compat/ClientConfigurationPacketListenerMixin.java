package com.example.builderbot.compat;

import com.example.builderbot.BuilderBotMod;
import net.minecraft.client.multiplayer.ClientConfigurationPacketListenerImpl;
import net.minecraft.network.protocol.configuration.ClientboundFinishConfigurationPacket;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ClientConfigurationPacketListenerImpl.class)
public abstract class ClientConfigurationPacketListenerMixin {

    @Inject(
        method = "handleConfigurationFinished",
        at = @At("HEAD"),
        cancellable = true,
        require = 0
    )
    private void builderbot$guardFinishConfiguration(
        ClientboundFinishConfigurationPacket packet, CallbackInfo ci) {
        BuilderBotMod.LOGGER.debug("[BuilderBot Compat] Handling FinishConfiguration packet smoothly.");
    }
}
