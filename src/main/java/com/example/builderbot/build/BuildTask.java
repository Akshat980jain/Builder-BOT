package com.example.builderbot.build;

import net.minecraft.core.BlockPos;
import net.minecraft.world.level.block.state.BlockState;

public record BuildTask(BlockPos pos, BlockState state) {}
