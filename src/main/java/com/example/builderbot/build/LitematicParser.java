package com.example.builderbot.build;

import com.example.builderbot.BuilderBotMod;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Holder;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.NbtAccounter;
import net.minecraft.nbt.NbtIo;
import net.minecraft.resources.Identifier;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * High-performance parser for Litematica (.litematic) and structure (.nbt) files.
 */
public class LitematicParser {

    private record RawBlockEntry(int x, int y, int z, BlockState state) {}

    private LitematicParser() {}

    /**
     * Loads a .litematic or .nbt file from disk and constructs an optimized BuildPlan.
     */
    public static Optional<BuildPlan> loadFile(File file, BlockPos origin) {
        if (!file.exists() || !file.isFile()) {
            BuilderBotMod.LOGGER.warn("[BuilderBot] Schematic file does not exist: {}", file.getAbsolutePath());
            return Optional.empty();
        }

        String name = file.getName().toLowerCase();
        if (name.endsWith(".litematic")) {
            return parseLitematic(file.toPath(), origin);
        } else if (name.endsWith(".nbt")) {
            return parseStructureNbt(file.toPath(), origin);
        }

        BuilderBotMod.LOGGER.warn("[BuilderBot] Unsupported schematic file format: {}", name);
        return Optional.empty();
    }

    /**
     * Parses a .litematic file.
     */
    public static Optional<BuildPlan> parseLitematic(Path path, BlockPos origin) {
        try (InputStream in = new FileInputStream(path.toFile())) {
            CompoundTag root = NbtIo.readCompressed(in, NbtAccounter.unlimitedHeap());
            if (root == null || !root.contains("Regions")) {
                BuilderBotMod.LOGGER.warn("[BuilderBot] Invalid .litematic root tag in {}", path);
                return Optional.empty();
            }

            CompoundTag regions = getCompound(root, "Regions");
            List<RawBlockEntry> rawBlocks = new ArrayList<>();
            int minX = Integer.MAX_VALUE;
            int minY = Integer.MAX_VALUE;
            int minZ = Integer.MAX_VALUE;

            for (String regionName : regions.keySet()) {
                CompoundTag region = getCompound(regions, regionName);
                CompoundTag posTag = getCompound(region, "Position");
                CompoundTag sizeTag = getCompound(region, "Size");

                int relX = getInt(posTag, "x");
                int relY = getInt(posTag, "y");
                int relZ = getInt(posTag, "z");

                int rawSizeX = getInt(sizeTag, "x");
                int rawSizeY = getInt(sizeTag, "y");
                int rawSizeZ = getInt(sizeTag, "z");

                int sizeX = Math.abs(rawSizeX);
                int sizeY = Math.abs(rawSizeY);
                int sizeZ = Math.abs(rawSizeZ);

                int dirX = rawSizeX < 0 ? -1 : 1;
                int dirY = rawSizeY < 0 ? -1 : 1;
                int dirZ = rawSizeZ < 0 ? -1 : 1;

                // 1. Parse Palette
                ListTag paletteTag = getList(region, "BlockStatePalette");
                List<BlockState> palette = new ArrayList<>();
                for (int i = 0; i < paletteTag.size(); i++) {
                    CompoundTag blockEntry = paletteTag.getCompound(i).orElseGet(CompoundTag::new);
                    palette.add(parseBlockState(blockEntry));
                }

                if (palette.isEmpty()) {
                    palette.add(Blocks.AIR.defaultBlockState());
                }

                // 2. Decode Bit-packed BlockStates
                long[] blockStates = getLongArray(region, "BlockStates");
                int bitsPerEntry = Math.max(2, Math.max(1, 32 - Integer.numberOfLeadingZeros(palette.size() - 1)));
                long maxEntryValue = (1L << bitsPerEntry) - 1L;

                int totalVolume = sizeX * sizeY * sizeZ;
                for (int index = 0; index < totalVolume; index++) {
                    int y = index / (sizeX * sizeZ);
                    int rem = index % (sizeX * sizeZ);
                    int z = rem / sizeX;
                    int x = rem % sizeX;

                    int paletteIndex = 0;
                    if (blockStates.length > 0) {
                        int startBit = index * bitsPerEntry;
                        int startLongIndex = startBit / 64;
                        int startBitOffset = startBit % 64;

                        if (startLongIndex < blockStates.length) {
                            long value = blockStates[startLongIndex] >>> startBitOffset;
                            int bitsRemaining = 64 - startBitOffset;

                            if (bitsRemaining < bitsPerEntry && startLongIndex + 1 < blockStates.length) {
                                value |= blockStates[startLongIndex + 1] << bitsRemaining;
                            }

                            paletteIndex = (int) (value & maxEntryValue);
                        }
                    }

                    if (paletteIndex >= 0 && paletteIndex < palette.size()) {
                        BlockState state = palette.get(paletteIndex);
                        if (!state.isAir()) {
                            int bx = relX + (dirX < 0 ? -(sizeX - 1 - x) : x);
                            int by = relY + (dirY < 0 ? -(sizeY - 1 - y) : y);
                            int bz = relZ + (dirZ < 0 ? -(sizeZ - 1 - z) : z);
                            rawBlocks.add(new RawBlockEntry(bx, by, bz, state));
                            if (bx < minX) minX = bx;
                            if (by < minY) minY = by;
                            if (bz < minZ) minZ = bz;
                        }
                    }
                }
            }

            if (rawBlocks.isEmpty()) {
                BuilderBotMod.LOGGER.warn("[BuilderBot] .litematic contained no solid blocks: {}", path);
                return Optional.empty();
            }

            // Anchor lowest corner at origin (0, 0, 0)
            List<BuildTask> tasks = new ArrayList<>(rawBlocks.size());
            for (RawBlockEntry rb : rawBlocks) {
                BlockPos worldPos = origin.offset(rb.x - minX, rb.y - minY, rb.z - minZ);
                tasks.add(new BuildTask(worldPos, rb.state));
            }

            // Sort bottom-to-top
            tasks.sort((a, b) -> {
                int cmpY = Integer.compare(a.pos().getY(), b.pos().getY());
                if (cmpY != 0) return cmpY;
                int cmpZ = Integer.compare(a.pos().getZ(), b.pos().getZ());
                if (cmpZ != 0) return cmpZ;
                return Integer.compare(a.pos().getX(), b.pos().getX());
            });

            BuilderBotMod.LOGGER.info("[BuilderBot] Parsed .litematic successfully: {} blocks loaded from {}",
                    tasks.size(), path.getFileName());
            return Optional.of(new BuildPlan(tasks));

        } catch (Exception e) {
            BuilderBotMod.LOGGER.error("[BuilderBot] Failed to parse .litematic file: {}", path, e);
            return Optional.empty();
        }
    }

    /**
     * Parses standard Minecraft structure NBT (.nbt) file.
     */
    public static Optional<BuildPlan> parseStructureNbt(Path path, BlockPos origin) {
        try (InputStream in = new FileInputStream(path.toFile())) {
            CompoundTag root = NbtIo.readCompressed(in, NbtAccounter.unlimitedHeap());
            if (root == null || !root.contains("blocks") || !root.contains("palette")) {
                BuilderBotMod.LOGGER.warn("[BuilderBot] Invalid structure NBT in {}", path);
                return Optional.empty();
            }

            ListTag paletteTag = getList(root, "palette");
            List<BlockState> palette = new ArrayList<>();
            for (int i = 0; i < paletteTag.size(); i++) {
                palette.add(parseBlockState(paletteTag.getCompound(i).orElseGet(CompoundTag::new)));
            }

            ListTag blocksTag = getList(root, "blocks");
            List<RawBlockEntry> rawBlocks = new ArrayList<>();
            int minX = Integer.MAX_VALUE;
            int minY = Integer.MAX_VALUE;
            int minZ = Integer.MAX_VALUE;

            for (int i = 0; i < blocksTag.size(); i++) {
                CompoundTag blockEntry = blocksTag.getCompound(i).orElseGet(CompoundTag::new);
                ListTag posTag = getList(blockEntry, "pos");
                int stateIdx = getInt(blockEntry, "state");

                if (posTag.size() == 3 && stateIdx >= 0 && stateIdx < palette.size()) {
                    BlockState state = palette.get(stateIdx);
                    if (!state.isAir()) {
                        int bx = posTag.getInt(0).orElse(0);
                        int by = posTag.getInt(1).orElse(0);
                        int bz = posTag.getInt(2).orElse(0);
                        rawBlocks.add(new RawBlockEntry(bx, by, bz, state));
                        if (bx < minX) minX = bx;
                        if (by < minY) minY = by;
                        if (bz < minZ) minZ = bz;
                    }
                }
            }

            if (rawBlocks.isEmpty()) {
                return Optional.empty();
            }

            List<BuildTask> tasks = new ArrayList<>(rawBlocks.size());
            for (RawBlockEntry rb : rawBlocks) {
                BlockPos pos = origin.offset(rb.x - minX, rb.y - minY, rb.z - minZ);
                tasks.add(new BuildTask(pos, rb.state));
            }

            // Sort bottom-to-top
            tasks.sort((a, b) -> {
                int cmpY = Integer.compare(a.pos().getY(), b.pos().getY());
                if (cmpY != 0) return cmpY;
                int cmpZ = Integer.compare(a.pos().getZ(), b.pos().getZ());
                if (cmpZ != 0) return cmpZ;
                return Integer.compare(a.pos().getX(), b.pos().getX());
            });
            return Optional.of(new BuildPlan(tasks));

        } catch (Exception e) {
            BuilderBotMod.LOGGER.error("[BuilderBot] Failed to parse .nbt file: {}", path, e);
            return Optional.empty();
        }
    }

    /**
     * Converts a palette CompoundTag (with "Name" and optional "Properties") into a Minecraft BlockState.
     */
    @SuppressWarnings({"unchecked", "rawtypes"})
    public static BlockState parseBlockState(CompoundTag tag) {
        String name = getString(tag, "Name");
        Identifier id = Identifier.tryParse(name);
        if (id == null) return Blocks.AIR.defaultBlockState();

        Optional<Holder.Reference<Block>> blockRef = BuiltInRegistries.BLOCK.get(id);
        if (blockRef.isEmpty()) return Blocks.AIR.defaultBlockState();

        Block block = blockRef.get().value();
        BlockState state = block.defaultBlockState();

        if (tag.contains("Properties")) {
            CompoundTag props = getCompound(tag, "Properties");
            for (String key : props.keySet()) {
                Property prop = block.getStateDefinition().getProperty(key);
                if (prop != null) {
                    String valStr = getString(props, key);
                    Optional<?> optVal = prop.getValue(valStr);
                    if (optVal.isPresent()) {
                        state = (BlockState) state.setValue(prop, (Comparable) optVal.get());
                    }
                }
            }
        }

        return state;
    }

    // ── 26.2 NBT CONVENIENCE GETTERS ──────────────────────────────────────────

    public static CompoundTag getCompound(CompoundTag tag, String key) {
        return tag.getCompound(key).orElseGet(CompoundTag::new);
    }

    public static int getInt(CompoundTag tag, String key) {
        return tag.getInt(key).orElse(0);
    }

    public static String getString(CompoundTag tag, String key) {
        return tag.getString(key).orElse("");
    }

    public static ListTag getList(CompoundTag tag, String key) {
        return tag.getList(key).orElseGet(ListTag::new);
    }

    public static long[] getLongArray(CompoundTag tag, String key) {
        return tag.getLongArray(key).orElse(new long[0]);
    }
}
