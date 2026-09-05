package com.example.builderbot.build;

import com.example.builderbot.BuilderBotMod;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.core.BlockPos;

import java.awt.Desktop;
import java.io.File;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

/**
 * Manages discovery, loading, and directory access for schematic files.
 */
public class SchematicManager {

    private static File schematicsDir;

    static {
        initDirectory();
    }

    public static void initDirectory() {
        Path gameDir = FabricLoader.getInstance().getGameDir();
        schematicsDir = gameDir.resolve("schematics").toFile();
        if (!schematicsDir.exists()) {
            schematicsDir.mkdirs();
        }
    }

    public static File getSchematicsDir() {
        if (schematicsDir == null || !schematicsDir.exists()) {
            initDirectory();
        }
        return schematicsDir;
    }

    /**
     * Scans and returns all available .litematic and .nbt files in .minecraft/schematics/.
     */
    public static List<File> listSchematics() {
        File dir = getSchematicsDir();
        if (!dir.exists() || !dir.isDirectory()) {
            return Collections.emptyList();
        }

        File[] files = dir.listFiles((d, name) -> {
            String lower = name.toLowerCase();
            return lower.endsWith(".litematic") || lower.endsWith(".nbt");
        });

        if (files == null) return Collections.emptyList();
        List<File> list = new ArrayList<>(Arrays.asList(files));
        list.sort((a, b) -> a.getName().compareToIgnoreCase(b.getName()));
        return list;
    }

    /**
     * Loads a schematic from the schematics directory by filename.
     */
    public static Optional<BuildPlan> loadByName(String filename, BlockPos origin) {
        File dir = getSchematicsDir();
        File file = new File(dir, filename);

        if (!file.exists()) {
            // Try appending extension if omitted
            if (!filename.contains(".")) {
                File litematic = new File(dir, filename + ".litematic");
                if (litematic.exists()) file = litematic;
                else {
                    File nbt = new File(dir, filename + ".nbt");
                    if (nbt.exists()) file = nbt;
                }
            }
        }

        if (!file.exists()) {
            BuilderBotMod.LOGGER.warn("[BuilderBot] Schematic file not found: {}", filename);
            return Optional.empty();
        }

        return LitematicParser.loadFile(file, origin);
    }

    /**
     * Opens the .minecraft/schematics directory in Windows File Explorer.
     */
    public static void openSchematicsFolder() {
        File dir = getSchematicsDir();
        try {
            if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.OPEN)) {
                Desktop.getDesktop().open(dir);
            } else {
                new ProcessBuilder("explorer.exe", dir.getAbsolutePath()).start();
            }
        } catch (Exception e) {
            BuilderBotMod.LOGGER.error("[BuilderBot] Could not open schematics folder", e);
        }
    }
}
