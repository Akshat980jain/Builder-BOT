package com.example.builderbot.command;

import com.example.builderbot.build.BuildHistoryManager;
import com.example.builderbot.build.BuildPlan;
import com.example.builderbot.build.BuildTask;
import com.example.builderbot.build.ExcavationManager;
import com.example.builderbot.build.PreviewManager;
import com.example.builderbot.build.ProceduralGenerator;
import com.example.builderbot.build.SchematicLoader;
import com.example.builderbot.build.SchematicManager;
import com.example.builderbot.build.SwarmManager;
import com.example.builderbot.entity.BuilderBotEntity;
import com.example.builderbot.entity.ModEntities;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.BoolArgumentType;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.arguments.IdentifierArgument;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.AABB;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

public class BuilderBotCommands {

    private BuilderBotCommands() {}

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("builderbot")
                .requires(src -> true)

                .then(Commands.literal("spawn")
                        .executes(ctx -> executeSpawn(ctx.getSource())))

                .then(Commands.literal("build")
                        .then(Commands.argument("structure", IdentifierArgument.id())
                                .executes(ctx -> executeBuild(
                                        ctx.getSource(),
                                        IdentifierArgument.getId(ctx, "structure"),
                                        1, 0))))

                .then(Commands.literal("status")
                        .executes(ctx -> executeStatus(ctx.getSource())))

                .then(Commands.literal("menu")
                        .executes(ctx -> executeMenu(ctx.getSource())))

                .then(Commands.literal("panel")
                        .executes(ctx -> executeMenu(ctx.getSource())))

                .then(Commands.literal("stop")
                        .executes(ctx -> executeStop(ctx.getSource())))

                .then(Commands.literal("stopall")
                        .executes(ctx -> executeStopAll(ctx.getSource())))

                .then(Commands.literal("fly")
                        .executes(ctx -> executeToggleFly(ctx.getSource())))

                .then(Commands.literal("tp")
                        .executes(ctx -> executeTeleport(ctx.getSource())))

                .then(Commands.literal("despawn")
                        .executes(ctx -> executeDespawn(ctx.getSource())))

                .then(Commands.literal("despawnall")
                        .executes(ctx -> executeDespawnAll(ctx.getSource())))

                .then(Commands.literal("undo")
                        .executes(ctx -> executeUndo(ctx.getSource(), 3)))

                .then(Commands.literal("cleararea")
                        .then(Commands.argument("radius", IntegerArgumentType.integer(1, 64))
                                .then(Commands.argument("height", IntegerArgumentType.integer(1, 64))
                                        .executes(ctx -> executeClearArea(
                                                ctx.getSource(),
                                                IntegerArgumentType.getInteger(ctx, "radius"),
                                                IntegerArgumentType.getInteger(ctx, "height"),
                                                3)))))

                // Procedural Generators: /builderbot generate [pyramid|dome|tower|stairs]
                .then(Commands.literal("generate")
                        .then(Commands.literal("pyramid")
                                .then(Commands.argument("size", IntegerArgumentType.integer(3, 64))
                                        .executes(ctx -> executeGeneratePyramid(
                                                ctx.getSource(),
                                                IntegerArgumentType.getInteger(ctx, "size"),
                                                3, false))))
                        .then(Commands.literal("dome")
                                .then(Commands.argument("radius", IntegerArgumentType.integer(3, 32))
                                        .executes(ctx -> executeGenerateDome(
                                                ctx.getSource(),
                                                IntegerArgumentType.getInteger(ctx, "radius"),
                                                3, true))))
                        .then(Commands.literal("tower")
                                .then(Commands.argument("radius", IntegerArgumentType.integer(2, 16))
                                        .then(Commands.argument("height", IntegerArgumentType.integer(5, 64))
                                                .executes(ctx -> executeGenerateTower(
                                                        ctx.getSource(),
                                                        IntegerArgumentType.getInteger(ctx, "radius"),
                                                        IntegerArgumentType.getInteger(ctx, "height"),
                                                        3)))))
                        .then(Commands.literal("stairs")
                                .then(Commands.argument("radius", IntegerArgumentType.integer(2, 16))
                                        .then(Commands.argument("height", IntegerArgumentType.integer(5, 64))
                                                .executes(ctx -> executeGenerateStairs(
                                                        ctx.getSource(),
                                                        IntegerArgumentType.getInteger(ctx, "radius"),
                                                        IntegerArgumentType.getInteger(ctx, "height"),
                                                        3))))))

                .then(Commands.literal("testbuild")
                        .executes(ctx -> executeTestBuild(ctx.getSource(), 3, 1))
                        .then(Commands.argument("size", IntegerArgumentType.integer(1, 32))
                                .executes(ctx -> executeTestBuild(
                                        ctx.getSource(),
                                        IntegerArgumentType.getInteger(ctx, "size"),
                                        1))))

                .then(Commands.literal("schematic")
                        .then(Commands.argument("file", StringArgumentType.greedyString())
                                .executes(ctx -> executeBuildSchematic(
                                        ctx.getSource(),
                                        StringArgumentType.getString(ctx, "file"),
                                        1, 0))))

                // Holographic Preview: /builderbot preview [clear | schematic <file> [rot]]
                .then(Commands.literal("preview")
                        .then(Commands.literal("clear")
                                .executes(ctx -> executeClearPreview(ctx.getSource())))
                        .then(Commands.literal("schematic")
                                .then(Commands.argument("file", StringArgumentType.greedyString())
                                        .executes(ctx -> executePreviewSchematic(
                                                ctx.getSource(),
                                                StringArgumentType.getString(ctx, "file"),
                                                0)))))

                // Swarm dispatcher command: /builderbot swarm <botCount> [schematic|testbuild|build|undo]
                .then(Commands.literal("swarm")
                        .then(Commands.argument("bots", IntegerArgumentType.integer(1, 10))
                                .then(Commands.literal("schematic")
                                        .then(Commands.argument("file", StringArgumentType.greedyString())
                                                .executes(ctx -> executeBuildSchematic(
                                                        ctx.getSource(),
                                                        StringArgumentType.getString(ctx, "file"),
                                                        IntegerArgumentType.getInteger(ctx, "bots"),
                                                        0))))
                                .then(Commands.literal("testbuild")
                                        .then(Commands.argument("size", IntegerArgumentType.integer(1, 32))
                                                .executes(ctx -> executeTestBuild(
                                                        ctx.getSource(),
                                                        IntegerArgumentType.getInteger(ctx, "size"),
                                                        IntegerArgumentType.getInteger(ctx, "bots")))))
                                .then(Commands.literal("build")
                                        .then(Commands.argument("structure", IdentifierArgument.id())
                                                .executes(ctx -> executeBuild(
                                                        ctx.getSource(),
                                                        IdentifierArgument.getId(ctx, "structure"),
                                                        IntegerArgumentType.getInteger(ctx, "bots"),
                                                        0))))
                                .then(Commands.literal("undo")
                                        .executes(ctx -> executeUndo(
                                                ctx.getSource(),
                                                IntegerArgumentType.getInteger(ctx, "bots"))))))

                .then(Commands.literal("openschematics")
                        .executes(ctx -> executeOpenSchematics(ctx.getSource())))

                .then(Commands.literal("paste")
                        .then(Commands.argument("structure", IdentifierArgument.id())
                                .executes(ctx -> executePaste(
                                        ctx.getSource(),
                                        IdentifierArgument.getId(ctx, "structure")))))
        );
    }

    private static int executeOpenSchematics(CommandSourceStack src) {
        SchematicManager.openSchematicsFolder();
        src.sendSuccess(() -> Component.literal("📂 Opened .minecraft/schematics folder."), false);
        return 1;
    }

    private static int executeBuildSchematic(CommandSourceStack src, String filename, int botCount, int rotation) {
        ServerLevel world = src.getLevel();
        BlockPos origin = BlockPos.containing(src.getPosition());
        Optional<BuildPlan> planOpt = SchematicManager.loadByName(filename, origin);
        if (planOpt.isEmpty()) {
            src.sendFailure(Component.literal("Failed to load schematic '" + filename + "'. Ensure file is in .minecraft/schematics/"));
            return 0;
        }

        BuildPlan plan = planOpt.get();
        if (rotation != 0) {
            plan = PreviewManager.transformPlan(plan, origin, rotation, BlockPos.ZERO);
        }

        final BuildPlan finalPlan = plan;
        PreviewManager.clearPreview();
        BuildHistoryManager.pushNewSession();
        List<BuilderBotEntity> swarm = SwarmManager.deploySwarm(world, src.getPosition(), botCount, finalPlan);
        src.sendSuccess(() -> Component.literal(
                "✔ Deployed workforce of " + swarm.size() + " bots for schematic '" + filename + "' — " + finalPlan.total() + " blocks to place collaboratively!"), false);
        return swarm.size();
    }

    private static int executeClearPreview(CommandSourceStack src) {
        PreviewManager.clearPreview();
        src.sendSuccess(() -> Component.literal("🔮 Holographic preview cleared."), false);
        return 1;
    }

    private static int executePreviewSchematic(CommandSourceStack src, String filename, int rotation) {
        ServerLevel world = src.getLevel();
        BlockPos origin = BlockPos.containing(src.getPosition());
        Optional<BuildPlan> planOpt = SchematicManager.loadByName(filename, origin);
        if (planOpt.isEmpty()) {
            src.sendFailure(Component.literal("Schematic not found: " + filename));
            return 0;
        }

        BuildPlan plan = planOpt.get();
        if (rotation != 0) {
            plan = PreviewManager.transformPlan(plan, origin, rotation, BlockPos.ZERO);
        }

        List<BuildTask> tasks = plan.getTasks();
        if (tasks.isEmpty()) {
            src.sendFailure(Component.literal("Schematic contains 0 blocks."));
            return 0;
        }

        int minX = tasks.stream().mapToInt(t -> t.pos().getX()).min().orElse(origin.getX());
        int maxX = tasks.stream().mapToInt(t -> t.pos().getX()).max().orElse(origin.getX());
        int minY = tasks.stream().mapToInt(t -> t.pos().getY()).min().orElse(origin.getY());
        int maxY = tasks.stream().mapToInt(t -> t.pos().getY()).max().orElse(origin.getY());
        int minZ = tasks.stream().mapToInt(t -> t.pos().getZ()).min().orElse(origin.getZ());
        int maxZ = tasks.stream().mapToInt(t -> t.pos().getZ()).max().orElse(origin.getZ());

        BlockPos minPos = new BlockPos(minX, minY, minZ);
        BlockPos maxPos = new BlockPos(maxX, maxY, maxZ);

        PreviewManager.startPreview(world, minPos, maxPos, filename, rotation);

        int sizeX = maxX - minX + 1;
        int sizeY = maxY - minY + 1;
        int sizeZ = maxZ - minZ + 1;
        src.sendSuccess(() -> Component.literal(
                "🔮 Hologram Active for '" + filename + "' (" + rotation + "°) — [" + sizeX + "W x " + sizeY + "H x " + sizeZ + "L] (" + tasks.size() + " blocks). Lasts 60s!"), false);
        return 1;
    }

    private static int executeUndo(CommandSourceStack src, int botCount) {
        ServerLevel world = src.getLevel();
        BuildPlan undoPlan = BuildHistoryManager.createUndoPlan();
        if (undoPlan == null || undoPlan.isEmpty()) {
            src.sendFailure(Component.literal("No build history found to undo."));
            return 0;
        }

        List<BuilderBotEntity> swarm = SwarmManager.deploySwarm(world, src.getPosition(), botCount, undoPlan);
        src.sendSuccess(() -> Component.literal(
                "⏪ Undo triggered: Workforce of " + swarm.size() + " bots rolling back " + undoPlan.total() + " blocks."), false);
        return swarm.size();
    }

    private static int executeClearArea(CommandSourceStack src, int radius, int height, int botCount) {
        ServerLevel world = src.getLevel();
        BlockPos center = BlockPos.containing(src.getPosition());
        BlockPos minPos = center.offset(-radius, 0, -radius);
        BlockPos maxPos = center.offset(radius, height, radius);

        BuildPlan clearPlan = ExcavationManager.createClearingPlan(world, minPos, maxPos);
        if (clearPlan.isEmpty()) {
            src.sendSuccess(() -> Component.literal("🌿 Area is already clear (no blocks to remove)."), false);
            return 0;
        }

        List<BuilderBotEntity> swarm = SwarmManager.deploySwarm(world, src.getPosition(), botCount, clearPlan);
        src.sendSuccess(() -> Component.literal(
                "🚜 Excavation started: " + swarm.size() + " bots clearing " + clearPlan.total() + " blocks in [" + (radius * 2 + 1) + "x" + height + "x" + (radius * 2 + 1) + "]."), false);
        return swarm.size();
    }

    private static int executeGeneratePyramid(CommandSourceStack src, int size, int botCount, boolean hollow) {
        ServerLevel world = src.getLevel();
        BlockPos origin = BlockPos.containing(src.getPosition());
        BuildPlan plan = ProceduralGenerator.generatePyramid(origin, size, Blocks.SANDSTONE.defaultBlockState(), hollow);

        BuildHistoryManager.pushNewSession();
        List<BuilderBotEntity> swarm = SwarmManager.deploySwarm(world, src.getPosition(), botCount, plan);
        src.sendSuccess(() -> Component.literal(
                "🏛 Generating Pyramid of size " + size + " — " + plan.total() + " blocks with " + swarm.size() + " bots!"), false);
        return swarm.size();
    }

    private static int executeGenerateDome(CommandSourceStack src, int radius, int botCount, boolean hollow) {
        ServerLevel world = src.getLevel();
        BlockPos origin = BlockPos.containing(src.getPosition());
        BuildPlan plan = ProceduralGenerator.generateDome(origin, radius, Blocks.GLASS.defaultBlockState(), hollow, false);

        BuildHistoryManager.pushNewSession();
        List<BuilderBotEntity> swarm = SwarmManager.deploySwarm(world, src.getPosition(), botCount, plan);
        src.sendSuccess(() -> Component.literal(
                "🏛 Generating Glass Dome of radius " + radius + " — " + plan.total() + " blocks with " + swarm.size() + " bots!"), false);
        return swarm.size();
    }

    private static int executeGenerateTower(CommandSourceStack src, int radius, int height, int botCount) {
        ServerLevel world = src.getLevel();
        BlockPos origin = BlockPos.containing(src.getPosition());
        BuildPlan plan = ProceduralGenerator.generateCastleTower(
                origin, radius, height,
                Blocks.STONE_BRICKS.defaultBlockState(),
                Blocks.SPRUCE_PLANKS.defaultBlockState());

        BuildHistoryManager.pushNewSession();
        List<BuilderBotEntity> swarm = SwarmManager.deploySwarm(world, src.getPosition(), botCount, plan);
        src.sendSuccess(() -> Component.literal(
                "🏛 Generating Castle Tower (r=" + radius + ", h=" + height + ") — " + plan.total() + " blocks with " + swarm.size() + " bots!"), false);
        return swarm.size();
    }

    private static int executeGenerateStairs(CommandSourceStack src, int radius, int height, int botCount) {
        ServerLevel world = src.getLevel();
        BlockPos origin = BlockPos.containing(src.getPosition());
        BuildPlan plan = ProceduralGenerator.generateSpiralStairs(
                origin, radius, height,
                Blocks.OAK_PLANKS.defaultBlockState(),
                Blocks.OAK_LOG.defaultBlockState());

        BuildHistoryManager.pushNewSession();
        List<BuilderBotEntity> swarm = SwarmManager.deploySwarm(world, src.getPosition(), botCount, plan);
        src.sendSuccess(() -> Component.literal(
                "🏛 Generating Spiral Staircase (h=" + height + ") — " + plan.total() + " blocks with " + swarm.size() + " bots!"), false);
        return swarm.size();
    }

    private static int executeSpawn(CommandSourceStack src) {
        ServerLevel world = src.getLevel();
        BuilderBotEntity bot = ModEntities.BUILDER_BOT.create(world, EntitySpawnReason.COMMAND);
        if (bot == null) {
            src.sendFailure(Component.literal("Failed to create Builder Bot entity."));
            return 0;
        }
        bot.setPos(src.getPosition().x, src.getPosition().y, src.getPosition().z);
        world.addFreshEntity(bot);
        src.sendSuccess(() -> Component.literal("✔ Builder Bot spawned. Right-click the bot to open its Control Panel!"), false);
        return 1;
    }

    private static int executeBuild(CommandSourceStack src, Identifier structureId, int botCount, int rotation) {
        ServerLevel world = src.getLevel();
        BlockPos origin = BlockPos.containing(src.getPosition());
        Optional<BuildPlan> planOpt = SchematicLoader.load(world, structureId, origin);
        if (planOpt.isEmpty()) {
            src.sendFailure(Component.literal("Structure not found or empty: " + structureId
                    + "\nMake sure the structure file is placed in data/<namespace>/structure/<name>.nbt"));
            return 0;
        }

        BuildPlan plan = planOpt.get();
        if (rotation != 0) {
            plan = PreviewManager.transformPlan(plan, origin, rotation, BlockPos.ZERO);
        }

        final BuildPlan finalPlan = plan;
        BuildHistoryManager.pushNewSession();
        List<BuilderBotEntity> swarm = SwarmManager.deploySwarm(world, src.getPosition(), botCount, finalPlan);
        src.sendSuccess(() -> Component.literal(
                "✔ Deployed workforce of " + swarm.size() + " bots for structure '" + structureId + "' — " + finalPlan.total() + " blocks to place!"), false);
        return swarm.size();
    }

    private static int executeStatus(CommandSourceStack src) {
        ServerLevel world = src.getLevel();
        Optional<BuilderBotEntity> botOpt = findNearestBot(src, world, 64);
        if (botOpt.isEmpty()) {
            src.sendFailure(Component.literal("No Builder Bot found within 64 blocks."));
            return 0;
        }

        BuilderBotEntity bot = botOpt.get();
        BuildPlan plan = bot.getCurrentPlan();

        if (plan == null || plan.isEmpty()) {
            src.sendSuccess(() -> Component.literal("🤖 Bot is idle (no active build plan)."), false);
        } else {
            src.sendSuccess(() -> Component.literal(String.format(
                    "🤖 Bot building: %d/%d blocks placed (%d%% done, %d remaining).",
                    plan.total() - plan.remaining(),
                    plan.total(),
                    plan.percentComplete(),
                    plan.remaining())), false);
        }
        return 1;
    }

    private static int executeMenu(CommandSourceStack src) {
        src.sendSuccess(() -> Component.literal("✨ Right-click any Builder Bot directly in your world to open its graphical Control Panel!"), false);
        return 1;
    }

    private static int executeStop(CommandSourceStack src) {
        ServerLevel world = src.getLevel();
        Optional<BuilderBotEntity> botOpt = findNearestBot(src, world, 64);
        if (botOpt.isEmpty()) {
            src.sendFailure(Component.literal("No Builder Bot found within 64 blocks."));
            return 0;
        }

        botOpt.get().assignPlan(null);
        botOpt.get().setFlying(false);
        src.sendSuccess(() -> Component.literal("⏹ Build plan cancelled. Bot is now idle."), false);
        return 1;
    }

    private static int executeStopAll(CommandSourceStack src) {
        ServerLevel world = src.getLevel();
        int stopped = SwarmManager.stopAll(world, src.getPosition(), 64.0);
        src.sendSuccess(() -> Component.literal("⏹ Stopped all " + stopped + " bots in the area."), false);
        return stopped;
    }

    private static int executeToggleFly(CommandSourceStack src) {
        ServerLevel world = src.getLevel();
        Optional<BuilderBotEntity> botOpt = findNearestBot(src, world, 64);
        if (botOpt.isEmpty()) {
            src.sendFailure(Component.literal("No Builder Bot found within 64 blocks."));
            return 0;
        }

        BuilderBotEntity bot = botOpt.get();
        boolean newFlyingState = !bot.isFlying();
        bot.setFlying(newFlyingState);

        src.sendSuccess(() -> Component.literal(
                newFlyingState ? "🕊 Creative Flight Mode: ENABLED (Hovering)" : "🚶 Creative Flight Mode: DISABLED (Walking)"), false);
        return 1;
    }

    private static int executeTeleport(CommandSourceStack src) {
        ServerLevel world = src.getLevel();
        Optional<BuilderBotEntity> botOpt = findNearestBot(src, world, 128);
        if (botOpt.isEmpty()) {
            src.sendFailure(Component.literal("No Builder Bot found within 128 blocks."));
            return 0;
        }

        BuilderBotEntity bot = botOpt.get();
        bot.teleportTo(src.getPosition().x, src.getPosition().y, src.getPosition().z);
        src.sendSuccess(() -> Component.literal("📍 Teleported Builder Bot to your position."), false);
        return 1;
    }

    private static int executeDespawn(CommandSourceStack src) {
        ServerLevel world = src.getLevel();
        Optional<BuilderBotEntity> botOpt = findNearestBot(src, world, 64);
        if (botOpt.isEmpty()) {
            src.sendFailure(Component.literal("No Builder Bot found within 64 blocks."));
            return 0;
        }

        botOpt.get().discard();
        src.sendSuccess(() -> Component.literal("💨 Builder Bot despawned."), false);
        return 1;
    }

    private static int executeDespawnAll(CommandSourceStack src) {
        ServerLevel world = src.getLevel();
        int count = SwarmManager.despawnAll(world, src.getPosition(), 64.0);
        src.sendSuccess(() -> Component.literal("💨 Despawned all " + count + " bots in the area."), false);
        return count;
    }

    private static int executeTestBuild(CommandSourceStack src, int size, int botCount) {
        ServerLevel world = src.getLevel();
        BlockPos origin = BlockPos.containing(src.getPosition()).above();
        List<BuildTask> tasks = new ArrayList<>();
        for (int y = 0; y < size; y++) {
            for (int x = 0; x < size; x++) {
                for (int z = 0; z < size; z++) {
                    tasks.add(new BuildTask(
                            origin.offset(x, y, z),
                            Blocks.OAK_PLANKS.defaultBlockState()));
                }
            }
        }

        BuildPlan plan = new BuildPlan(tasks);
        BuildHistoryManager.pushNewSession();
        List<BuilderBotEntity> swarm = SwarmManager.deploySwarm(world, src.getPosition(), botCount, plan);
        src.sendSuccess(() -> Component.literal(
                "✔ Deployed workforce of " + swarm.size() + " bots for " + size + "³ cube = " + plan.total() + " blocks!"), false);
        return swarm.size();
    }

    private static int executePaste(CommandSourceStack src, Identifier structureId) {
        ServerLevel world = src.getLevel();
        BlockPos origin = BlockPos.containing(src.getPosition());
        Optional<BuildPlan> planOpt = SchematicLoader.load(world, structureId, origin);

        if (planOpt.isEmpty()) {
            src.sendFailure(Component.literal("Structure not found: " + structureId));
            return 0;
        }

        BuildPlan plan = planOpt.get();
        int count = 0;
        while (!plan.isEmpty()) {
            BuildTask task = plan.poll();
            world.setBlock(task.pos(), task.state(), 3);
            count++;
        }

        final int placed = count;
        src.sendSuccess(() -> Component.literal("✔ Instantly pasted " + placed + " blocks from " + structureId + "."), false);
        return 1;
    }

    private static Optional<BuilderBotEntity> findNearestBot(CommandSourceStack src,
                                                              ServerLevel world,
                                                              double radius) {
        AABB searchBox = new AABB(
                src.getPosition().x - radius, src.getPosition().y - radius, src.getPosition().z - radius,
                src.getPosition().x + radius, src.getPosition().y + radius, src.getPosition().z + radius);

        return world.getEntitiesOfClass(BuilderBotEntity.class, searchBox, e -> true)
                .stream()
                .min((a, b) -> Double.compare(
                        a.distanceToSqr(src.getPosition().x, src.getPosition().y, src.getPosition().z),
                        b.distanceToSqr(src.getPosition().x, src.getPosition().y, src.getPosition().z)));
    }
}
