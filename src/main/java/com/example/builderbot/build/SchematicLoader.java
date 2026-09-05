package com.example.builderbot.build;

import com.example.builderbot.BuilderBotMod;
import net.minecraft.core.BlockPos;
import net.minecraft.resources.Identifier;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.levelgen.structure.templatesystem.StructurePlaceSettings;
import net.minecraft.world.level.levelgen.structure.templatesystem.StructureTemplate;
import net.minecraft.world.level.levelgen.structure.templatesystem.StructureTemplateManager;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

public class SchematicLoader {

    private SchematicLoader() {}

    public static Optional<BuildPlan> load(ServerLevel world,
                                           Identifier structureId,
                                           BlockPos origin) {
        StructureTemplateManager manager = world.getStructureManager();
        Optional<StructureTemplate> templateOpt = manager.get(structureId);

        if (templateOpt.isEmpty()) {
            BuilderBotMod.LOGGER.warn("[BuilderBot] Structure not found: {}", structureId);
            return Optional.empty();
        }

        StructureTemplate template = templateOpt.get();
        List<BuildTask> tasks = new ArrayList<>();

        List<StructureTemplate.StructureBlockInfo> blocks = template.filterBlocks(
                origin, new StructurePlaceSettings(), Blocks.AIR, false);

        for (StructureTemplate.StructureBlockInfo blockInfo : blocks) {
            tasks.add(new BuildTask(blockInfo.pos(), blockInfo.state()));
        }

        if (tasks.isEmpty()) {
            BuilderBotMod.LOGGER.warn("[BuilderBot] Structure {} loaded but contained no blocks.", structureId);
            return Optional.empty();
        }

        BuilderBotMod.LOGGER.info("[BuilderBot] Loaded structure {} — {} blocks at origin {}",
                structureId, tasks.size(), origin);
        return Optional.of(new BuildPlan(tasks));
    }
}
