package com.example.builderbot.client.gui;

import com.example.builderbot.build.BuildPlan;
import com.example.builderbot.build.SchematicManager;
import com.example.builderbot.entity.BuilderBotEntity;
import net.fabricmc.api.EnvType;
import net.fabricmc.api.Environment;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * High-performance modern Sci-Fi Command Suite for Minecraft Builder Bot.
 * Provides streamlined schematic selection, 3D ghost block holograms,
 * instant coordinate snapping, rotation matrix, and swarm fleet management.
 */
@Environment(EnvType.CLIENT)
public class BuilderBotScreen extends Screen {

    private final net.minecraft.world.entity.Entity bot;

    // Tabs: 0 = Schematics & Construction, 1 = Swarm Fleet & Site Tools
    private int currentTab = 0;

    // Schematics list & scrolling
    private List<File> allSchematicFiles = new ArrayList<>();
    private List<File> filteredSchematicFiles = new ArrayList<>();
    private int selectedSchematicIndex = -1;
    private int scrollOffset = 0;
    private static final int VISIBLE_ITEMS = 6;
    private static final int ITEM_HEIGHT = 18;

    // Transformation state
    private int selectedRotation = 0; // 0, 90, 180, 270

    // Workforce count state (1 to 10)
    private static int selectedBotCount = 10;

    // Modal state
    private boolean showDespawnModal = false;

    // Inputs & Widgets
    private EditBox searchBox;
    private EditBox structureInput;
    private EditBox coordXBox;
    private EditBox coordYBox;
    private EditBox coordZBox;
    private static String savedCoordX = "";
    private static String savedCoordY = "";
    private static String savedCoordZ = "";
    private final List<Button> tabButtons = new ArrayList<>();
    private final List<Button> activePageWidgets = new ArrayList<>();
    private Button approveDespawnThisBtn;
    private Button approveDespawnAllBtn;
    private Button cancelDespawnBtn;

    // Window Layout Dimensions
    private int winX, winY, winW, winH;
    private int listX, listY, listW, listH;

    public BuilderBotScreen(net.minecraft.world.entity.Entity bot) {
        super(Component.literal("Builder Bot Control Suite"));
        this.bot = bot;

        // Auto-switch all bots to OP and Creative mode immediately on opening
        ensureBotsInCreative();

        // Dynamically fetch live coordinates:
        // Prioritizes crosshair target block, falling back to standing position
        BlockPos dynamicPos = detectTargetPosition();
        if (dynamicPos != null) {
            savedCoordX = String.valueOf(dynamicPos.getX());
            savedCoordY = String.valueOf(dynamicPos.getY());
            savedCoordZ = String.valueOf(dynamicPos.getZ());
        } else if (bot != null) {
            BlockPos botPos = bot.blockPosition();
            savedCoordX = String.valueOf(botPos.getX());
            savedCoordY = String.valueOf(botPos.getY());
            savedCoordZ = String.valueOf(botPos.getZ());
        }
    }

    @Override
    protected void init() {
        if (coordXBox != null && !coordXBox.getValue().trim().isEmpty()) savedCoordX = coordXBox.getValue().trim();
        if (coordYBox != null && !coordYBox.getValue().trim().isEmpty()) savedCoordY = coordYBox.getValue().trim();
        if (coordZBox != null && !coordZBox.getValue().trim().isEmpty()) savedCoordZ = coordZBox.getValue().trim();

        this.clearWidgets();
        tabButtons.clear();
        activePageWidgets.clear();

        // Expansive, balanced modern window size
        this.winW = 440;
        this.winH = 265;
        this.winX = (this.width - winW) / 2;
        this.winY = (this.height - winH) / 2;

        this.listX = winX + 14;
        this.listY = winY + 76;
        this.listW = 185;
        this.listH = VISIBLE_ITEMS * ITEM_HEIGHT;

        loadSchematics();

        // ── TOP TAB NAVIGATION BUTTONS ────────────────────────────────────────
        int tabW = (winW - 28) / 2;
        Button tab0Btn = Button.builder(
                Component.literal(currentTab == 0 ? "⚡ 1. Blueprints & Build" : "📁 1. Blueprints & Build")
                        .withStyle(currentTab == 0 ? ChatFormatting.AQUA : ChatFormatting.GRAY),
                btn -> { currentTab = 0; this.init(); }
        ).bounds(winX + 14, winY + 28, tabW, 18).build();
        tabButtons.add(tab0Btn);
        this.addRenderableWidget(tab0Btn);

        Button tab1Btn = Button.builder(
                Component.literal(currentTab == 1 ? "⚡ 2. Swarm Fleet & Tools" : "⚙ 2. Swarm Fleet & Tools")
                        .withStyle(currentTab == 1 ? ChatFormatting.AQUA : ChatFormatting.GRAY),
                btn -> { currentTab = 1; this.init(); }
        ).bounds(winX + 14 + tabW, winY + 28, tabW, 18).build();
        tabButtons.add(tab1Btn);
        this.addRenderableWidget(tab1Btn);

        // ── BUILD ACTIVE TAB CONTENT ──────────────────────────────────────────
        switch (currentTab) {
            case 0 -> initSchematicsTab();
            case 1 -> initToolsTab();
        }

        // Bottom Bar: Close Menu Button
        Button closeBtn = Button.builder(
                Component.literal("✖ Close").withStyle(ChatFormatting.WHITE),
                btn -> this.onClose()
        ).bounds(winX + winW - 68, winY + winH - 22, 54, 16).build();
        addPageWidget(closeBtn);

        // ── DESPAWN CONFIRMATION MODAL BUTTONS ────────────────────────────────
        int modalW = 290;
        int modalH = 120;
        int modalX = (this.width - modalW) / 2;
        int modalY = (this.height - modalH) / 2;

        this.approveDespawnThisBtn = Button.builder(
                Component.literal("💨 Despawn Extra").withStyle(ChatFormatting.RED),
                btn -> {
                    runCommand("builderbot despawn");
                    this.onClose();
                }
        ).bounds(modalX + 12, modalY + 62, (modalW / 2) - 16, 22).build();

        this.approveDespawnAllBtn = Button.builder(
                Component.literal("💥 Despawn ALL").withStyle(ChatFormatting.DARK_RED, ChatFormatting.BOLD),
                btn -> {
                    runCommand("builderbot despawnall");
                    this.onClose();
                }
        ).bounds(modalX + (modalW / 2) + 4, modalY + 62, (modalW / 2) - 16, 22).build();

        this.cancelDespawnBtn = Button.builder(
                Component.literal("✖ Cancel (Keep Fleet)").withStyle(ChatFormatting.GREEN),
                btn -> setDespawnModalVisible(false)
        ).bounds(modalX + 12, modalY + 88, modalW - 24, 20).build();

        this.approveDespawnThisBtn.visible = false;
        this.approveDespawnAllBtn.visible = false;
        this.cancelDespawnBtn.visible = false;
        this.addRenderableWidget(this.approveDespawnThisBtn);
        this.addRenderableWidget(this.approveDespawnAllBtn);
        this.addRenderableWidget(this.cancelDespawnBtn);
    }

    private void addPageWidget(Button button) {
        activePageWidgets.add(button);
        this.addRenderableWidget(button);
    }

    // ── TAB 0: SCHEMATICS BROWSER & CONSTRUCTION DECK ────────────────────────
    private void initSchematicsTab() {
        // Left Column: Search Box
        this.searchBox = new EditBox(this.font, listX, winY + 54, listW, 16, Component.literal("Search"));
        this.searchBox.setHint(Component.literal("🔍 Search blueprints...").withStyle(ChatFormatting.DARK_GRAY));
        this.searchBox.setMaxLength(64);
        this.searchBox.setResponder(this::filterSchematics);
        this.addRenderableWidget(searchBox);

        // Action controls beneath list
        Button openFolderBtn = Button.builder(
                Component.literal("📂 Folder"),
                btn -> SchematicManager.openSchematicsFolder()
        ).bounds(listX, listY + listH + 6, (listW / 2) - 2, 18).build();
        addPageWidget(openFolderBtn);

        Button refreshBtn = Button.builder(
                Component.literal("🔄 Reload"),
                btn -> { loadSchematics(); this.scrollOffset = 0; }
        ).bounds(listX + (listW / 2) + 2, listY + listH + 6, (listW / 2) - 2, 18).build();
        addPageWidget(refreshBtn);

        // Right Column: Construction Controls
        int rightX = winX + 214;
        int rightY = winY + 54;
        int rightW = winW - 228;

        // 1. Coordinates Inputs: [X] [Y] [Z]
        int boxW = (rightW - 6) / 3;
        this.coordXBox = new EditBox(this.font, rightX, rightY + 14, boxW, 16, Component.literal("X"));
        this.coordXBox.setHint(Component.literal("X").withStyle(ChatFormatting.DARK_GRAY));
        this.coordXBox.setValue(savedCoordX);
        this.coordXBox.setResponder(val -> savedCoordX = val);
        this.addRenderableWidget(coordXBox);

        this.coordYBox = new EditBox(this.font, rightX + boxW + 3, rightY + 14, boxW, 16, Component.literal("Y"));
        this.coordYBox.setHint(Component.literal("Y").withStyle(ChatFormatting.DARK_GRAY));
        this.coordYBox.setValue(savedCoordY);
        this.coordYBox.setResponder(val -> savedCoordY = val);
        this.addRenderableWidget(coordYBox);

        this.coordZBox = new EditBox(this.font, rightX + (boxW * 2) + 6, rightY + 14, boxW, 16, Component.literal("Z"));
        this.coordZBox.setHint(Component.literal("Z").withStyle(ChatFormatting.DARK_GRAY));
        this.coordZBox.setValue(savedCoordZ);
        this.coordZBox.setResponder(val -> savedCoordZ = val);
        this.addRenderableWidget(coordZBox);

        // 2. Position Auto-Snap Chips: [ 🎯 Crosshair ] [ 📍 My Pos ] [ 🤖 Bot Pos ]
        int chipW = (rightW - 6) / 3;
        Button crosshairBtn = Button.builder(
                Component.literal("🎯 Target").withStyle(ChatFormatting.GREEN),
                btn -> fillTargetPosition()
        ).bounds(rightX, rightY + 34, chipW, 16).build();
        addPageWidget(crosshairBtn);

        Button myPosBtn = Button.builder(
                Component.literal("📍 Player").withStyle(ChatFormatting.AQUA),
                btn -> fillMyPosition()
        ).bounds(rightX + chipW + 3, rightY + 34, chipW, 16).build();
        addPageWidget(myPosBtn);

        Button botPosBtn = Button.builder(
                Component.literal("🤖 Bot").withStyle(ChatFormatting.YELLOW),
                btn -> fillBotPosition()
        ).bounds(rightX + (chipW * 2) + 6, rightY + 34, chipW, 16).build();
        addPageWidget(botPosBtn);

        // 3. Orientation / Rotation Compass Buttons: [ 0° N ] [ 90° E ] [ 180° S ] [ 270° W ]
        int rotW = (rightW - 6) / 4;
        String[] rotLabels = { "0° N", "90° E", "180° S", "270° W" };
        for (int i = 0; i < 4; i++) {
            final int deg = i * 90;
            boolean isSelected = (selectedRotation == deg);
            Button rotBtn = Button.builder(
                    Component.literal(rotLabels[i]).withStyle(isSelected ? ChatFormatting.GOLD : ChatFormatting.WHITE),
                    btn -> { this.selectedRotation = deg; this.init(); }
            ).bounds(rightX + (i * (rotW + 2)), rightY + 66, rotW, 16).build();
            addPageWidget(rotBtn);
        }

        // 4. Workforce Stepper
        initWorkforceStepper(rightX, rightY + 98, rightW);

        // 5. 3D Ghost Blueprint Overlay Toggle
        boolean hasGhost = com.example.builderbot.client.render.ClientGhostRenderer.hasActiveGhost();
        Component previewLabel = hasGhost
                ? Component.literal("❌ Clear 3D Ghost Blocks").withStyle(ChatFormatting.RED, ChatFormatting.BOLD)
                : Component.literal("🔮 Preview 3D Ghost Blocks").withStyle(ChatFormatting.AQUA, ChatFormatting.BOLD);

        Button previewBtn = Button.builder(
                previewLabel,
                btn -> onPreviewSchematic()
        ).bounds(rightX, rightY + 120, rightW, 17).build();
        addPageWidget(previewBtn);

        // 6. Prominent Primary Action: [ 🚀 LAUNCH SWARM BUILD ]
        Button launchBuildBtn = Button.builder(
                Component.literal("🚀 LAUNCH SWARM BUILD").withStyle(ChatFormatting.GOLD, ChatFormatting.BOLD),
                btn -> onBuildSelectedSchematic()
        ).bounds(rightX, rightY + 140, rightW, 20).build();
        addPageWidget(launchBuildBtn);

        // 7. Manual Structure ID Input Bar
        this.structureInput = new EditBox(this.font, rightX, rightY + 164, rightW - 46, 16, Component.literal("ID"));
        this.structureInput.setHint(Component.literal("Structure / shape ID...").withStyle(ChatFormatting.DARK_GRAY));
        this.addRenderableWidget(structureInput);

        Button manualBuildBtn = Button.builder(
                Component.literal("Build").withStyle(ChatFormatting.GREEN),
                btn -> onManualBuild()
        ).bounds(rightX + rightW - 42, rightY + 164, 42, 16).build();
        addPageWidget(manualBuildBtn);
    }

    public static BlockPos detectTargetPosition() {
        Minecraft mc = Minecraft.getInstance();
        if (mc.hitResult instanceof BlockHitResult blockHit && blockHit.getType() == HitResult.Type.BLOCK) {
            return blockHit.getBlockPos().relative(blockHit.getDirection());
        }
        if (mc.player != null) {
            return mc.player.blockPosition();
        }
        return null;
    }

    private void fillTargetPosition() {
        BlockPos pos = detectTargetPosition();
        if (pos != null) {
            savedCoordX = String.valueOf(pos.getX());
            savedCoordY = String.valueOf(pos.getY());
            savedCoordZ = String.valueOf(pos.getZ());
            if (coordXBox != null) coordXBox.setValue(savedCoordX);
            if (coordYBox != null) coordYBox.setValue(savedCoordY);
            if (coordZBox != null) coordZBox.setValue(savedCoordZ);
        }
    }

    private void fillMyPosition() {
        if (Minecraft.getInstance().player != null) {
            BlockPos pos = Minecraft.getInstance().player.blockPosition();
            savedCoordX = String.valueOf(pos.getX());
            savedCoordY = String.valueOf(pos.getY());
            savedCoordZ = String.valueOf(pos.getZ());
            if (coordXBox != null) coordXBox.setValue(savedCoordX);
            if (coordYBox != null) coordYBox.setValue(savedCoordY);
            if (coordZBox != null) coordZBox.setValue(savedCoordZ);
        }
    }

    public static BlockPos findBotPosition() {
        if (Minecraft.getInstance().level != null) {
            var botOpt = Minecraft.getInstance().level.players().stream()
                    .filter(p -> {
                        if (p == Minecraft.getInstance().player) return false;
                        String name = p.getName().getString().toLowerCase();
                        return name.contains("builderbot") || name.contains("builder");
                    })
                    .findFirst();
            if (botOpt.isPresent()) {
                return botOpt.get().blockPosition();
            }
        }
        return null;
    }

    private void fillBotPosition() {
        BlockPos pos = (this.bot != null) ? this.bot.blockPosition() : findBotPosition();
        if (pos != null) {
            savedCoordX = String.valueOf(pos.getX());
            savedCoordY = String.valueOf(pos.getY());
            savedCoordZ = String.valueOf(pos.getZ());
            if (coordXBox != null) coordXBox.setValue(savedCoordX);
            if (coordYBox != null) coordYBox.setValue(savedCoordY);
            if (coordZBox != null) coordZBox.setValue(savedCoordZ);
        } else {
            fillMyPosition();
        }
    }

    public BlockPos getTargetOrigin() {
        String xs = coordXBox != null ? coordXBox.getValue().trim() : savedCoordX.trim();
        String ys = coordYBox != null ? coordYBox.getValue().trim() : savedCoordY.trim();
        String zs = coordZBox != null ? coordZBox.getValue().trim() : savedCoordZ.trim();
        if (!xs.isEmpty() && !ys.isEmpty() && !zs.isEmpty()) {
            try {
                int x = (int) Math.floor(Double.parseDouble(xs.replace(",", "")));
                int y = (int) Math.floor(Double.parseDouble(ys.replace(",", "")));
                int z = (int) Math.floor(Double.parseDouble(zs.replace(",", "")));
                return new BlockPos(x, y, z);
            } catch (NumberFormatException ignored) {}
        }
        return null;
    }

    private String buildCoordArgsString() {
        BlockPos origin = getTargetOrigin();
        if (origin != null) {
            return " " + origin.getX() + " " + origin.getY() + " " + origin.getZ() + " " + selectedRotation;
        }
        return selectedRotation > 0 ? " " + selectedRotation : "";
    }

    // ── TAB 1: SWARM FLEET & TACTICAL TOOLS ──────────────────────────────────
    private void initToolsTab() {
        int leftX = winX + 14;
        int cardW = (winW - 36) / 2;
        int rightX = leftX + cardW + 8;
        int startY = winY + 68;

        // LEFT CARD: FLEET CONTROLS
        initWorkforceStepper(leftX, startY, cardW);

        // Quick Preset Buttons: [ 1 Solo ] [ 3 Squad ] [ 5 Team ] [ 10 Max ]
        int pW = (cardW - 6) / 4;
        int[] presets = { 1, 3, 5, 10 };
        String[] pLabels = { "1", "3", "5", "10" };
        for (int i = 0; i < 4; i++) {
            final int count = presets[i];
            Button pBtn = Button.builder(
                    Component.literal(pLabels[i] + " Bots").withStyle(selectedBotCount == count ? ChatFormatting.GOLD : ChatFormatting.WHITE),
                    btn -> { selectedBotCount = count; this.init(); }
            ).bounds(leftX + (i * (pW + 2)), startY + 20, pW, 16).build();
            addPageWidget(pBtn);
        }

        // Re-Enforce OP & Creative
        Button reopBtn = Button.builder(
                Component.literal("👑 Re-Op & Creative Mode").withStyle(ChatFormatting.GOLD),
                btn -> {
                    ensureBotsInCreative();
                    runCommand("builderbot op");
                    if (Minecraft.getInstance().player != null) {
                        Minecraft.getInstance().player.sendSystemMessage(
                                Component.literal("§a[BuilderBot] Operator role and Creative mode enforced across fleet!"));
                    }
                }
        ).bounds(leftX, startY + 42, cardW, 18).build();
        addPageWidget(reopBtn);

        // Teleport Fleet to Me
        Button tpBtn = Button.builder(
                Component.literal("📍 Teleport Fleet to Me").withStyle(ChatFormatting.YELLOW),
                btn -> { runCommand("builderbot tp"); this.onClose(); }
        ).bounds(leftX, startY + 64, cardW, 18).build();
        addPageWidget(tpBtn);

        // Flight Mode Toggle
        boolean isFlying = (bot instanceof BuilderBotEntity b) && b.isFlying();
        Button toggleFlyBtn = Button.builder(
                Component.literal(isFlying ? "🕊 Flight: ENABLED" : "🚶 Flight: DISABLED")
                        .withStyle(isFlying ? ChatFormatting.AQUA : ChatFormatting.GRAY),
                btn -> {
                    runCommand("builderbot fly");
                    boolean nowFlying = (bot instanceof BuilderBotEntity b) && !b.isFlying();
                    btn.setMessage(Component.literal(nowFlying ? "🕊 Flight: ENABLED" : "🚶 Flight: DISABLED")
                            .withStyle(nowFlying ? ChatFormatting.AQUA : ChatFormatting.GRAY));
                }
        ).bounds(leftX, startY + 86, cardW, 18).build();
        addPageWidget(toggleFlyBtn);

        // Despawn Options
        Button despawnBtn = Button.builder(
                Component.literal("💨 Despawn Fleet Options...").withStyle(ChatFormatting.DARK_RED),
                btn -> setDespawnModalVisible(true)
        ).bounds(leftX, startY + 110, cardW, 20).build();
        addPageWidget(despawnBtn);

        // RIGHT CARD: SITE & BUILD COMMANDS
        // Undo Last Build
        Button undoBtn = Button.builder(
                Component.literal("⏪ Undo Last Build").withStyle(ChatFormatting.YELLOW, ChatFormatting.BOLD),
                btn -> { runCommand("builderbot undo"); this.onClose(); }
        ).bounds(rightX, startY, cardW, 20).build();
        addPageWidget(undoBtn);

        // Site Clearing
        Button clearArea16 = Button.builder(
                Component.literal("🚜 Clear Site (16x16x16)"),
                btn -> { runCommand("builderbot cleararea 8 16"); this.onClose(); }
        ).bounds(rightX, startY + 24, cardW, 18).build();
        addPageWidget(clearArea16);

        Button clearArea32 = Button.builder(
                Component.literal("🚜 Mega Excavate (32x32x24)"),
                btn -> { runCommand("builderbot cleararea 16 24"); this.onClose(); }
        ).bounds(rightX, startY + 46, cardW, 18).build();
        addPageWidget(clearArea32);

        // EMERGENCY STOP ALL
        Button stopBtn = Button.builder(
                Component.literal("⏹ EMERGENCY STOP ALL").withStyle(ChatFormatting.RED, ChatFormatting.BOLD),
                btn -> { runCommand("builderbot stopall"); this.onClose(); }
        ).bounds(rightX, startY + 70, cardW, 22).build();
        addPageWidget(stopBtn);
    }

    private void initWorkforceStepper(int x, int y, int width) {
        Button decBotBtn = Button.builder(
                Component.literal("-").withStyle(ChatFormatting.RED, ChatFormatting.BOLD),
                btn -> { if (selectedBotCount > 1) { selectedBotCount--; this.init(); } }
        ).bounds(x, y, 20, 16).build();
        addPageWidget(decBotBtn);

        String botDesc = selectedBotCount == 1 ? "1 Bot (Solo)" : selectedBotCount + " Bots (Swarm)";
        Button botCountDisplay = Button.builder(
                Component.literal("👥 " + botDesc).withStyle(ChatFormatting.YELLOW),
                btn -> {}
        ).bounds(x + 22, y, width - 44, 16).build();
        botCountDisplay.active = false;
        addPageWidget(botCountDisplay);

        Button incBotBtn = Button.builder(
                Component.literal("+").withStyle(ChatFormatting.GREEN, ChatFormatting.BOLD),
                btn -> { if (selectedBotCount < 10) { selectedBotCount++; this.init(); } }
        ).bounds(x + width - 20, y, 20, 16).build();
        addPageWidget(incBotBtn);
    }

    private void loadSchematics() {
        this.allSchematicFiles = SchematicManager.listSchematics();
        filterSchematics(searchBox != null ? searchBox.getValue() : "");
        if (selectedSchematicIndex < 0 && !filteredSchematicFiles.isEmpty()) {
            selectedSchematicIndex = 0;
        }
    }

    private void filterSchematics(String query) {
        String filter = query.toLowerCase().trim();
        if (filter.isEmpty()) {
            this.filteredSchematicFiles = new ArrayList<>(allSchematicFiles);
        } else {
            this.filteredSchematicFiles = allSchematicFiles.stream()
                    .filter(f -> f.getName().toLowerCase().contains(filter))
                    .toList();
        }

        if (selectedSchematicIndex >= filteredSchematicFiles.size()) {
            selectedSchematicIndex = filteredSchematicFiles.isEmpty() ? -1 : 0;
        }
        if (selectedSchematicIndex < 0 && !filteredSchematicFiles.isEmpty()) {
            selectedSchematicIndex = 0;
        }
        clampScroll();
    }

    private void scrollBy(int delta) {
        this.scrollOffset += delta;
        clampScroll();
    }

    private void clampScroll() {
        int maxScroll = Math.max(0, filteredSchematicFiles.size() - VISIBLE_ITEMS);
        if (scrollOffset > maxScroll) scrollOffset = maxScroll;
        if (scrollOffset < 0) scrollOffset = 0;
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
        if (!showDespawnModal && currentTab == 0) {
            if (mouseX >= listX && mouseX <= listX + listW && mouseY >= listY && mouseY <= listY + listH) {
                if (scrollY > 0) scrollBy(-1);
                else if (scrollY < 0) scrollBy(1);
                return true;
            }
        }
        return super.mouseScrolled(mouseX, mouseY, scrollX, scrollY);
    }

    @Override
    public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
        if (!showDespawnModal && currentTab == 0) {
            double mx = event.x();
            double my = event.y();

            if (mx >= listX && mx <= listX + listW && my >= listY && my <= listY + listH) {
                int rowClicked = (int) ((my - listY) / ITEM_HEIGHT);
                int clickedIndex = scrollOffset + rowClicked;
                if (clickedIndex >= 0 && clickedIndex < filteredSchematicFiles.size()) {
                    this.selectedSchematicIndex = clickedIndex;
                    if (doubleClick) {
                        onBuildSelectedSchematic();
                    }
                    return true;
                }
            }
        }
        return super.mouseClicked(event, doubleClick);
    }

    private void setDespawnModalVisible(boolean visible) {
        this.showDespawnModal = visible;
        this.approveDespawnThisBtn.visible = visible;
        this.approveDespawnAllBtn.visible = visible;
        this.cancelDespawnBtn.visible = visible;
        this.approveDespawnThisBtn.active = visible;
        this.approveDespawnAllBtn.active = visible;
        this.cancelDespawnBtn.active = visible;

        for (Button btn : activePageWidgets) btn.active = !visible;
        for (Button btn : tabButtons) btn.active = !visible;
        if (structureInput != null) structureInput.setEditable(!visible);
        if (searchBox != null) searchBox.setEditable(!visible);
    }

    private static boolean isBotPlayer(String playerName) {
        if (playerName == null) return false;
        String clean = playerName.replace("_", "").toLowerCase();
        return clean.startsWith("builderbot");
    }

    public static void ensureBotsInCreative() {
        var conn = Minecraft.getInstance().getConnection();
        if (conn != null && conn.getOnlinePlayers() != null) {
            for (var info : conn.getOnlinePlayers()) {
                if (info != null && info.getProfile() != null && isBotPlayer(info.getProfile().name())) {
                    String botName = info.getProfile().name();
                    conn.sendCommand("op " + botName);
                    conn.sendCommand("gamemode creative " + botName);
                }
            }
        }
    }

    private void sendOpPrepCommands(BlockPos origin) {
        var conn = Minecraft.getInstance().getConnection();
        if (conn != null && conn.getOnlinePlayers() != null) {
            ensureBotsInCreative();

            if (origin != null) {
                for (var info : conn.getOnlinePlayers()) {
                    if (info != null && info.getProfile() != null && isBotPlayer(info.getProfile().name())) {
                        String botName = info.getProfile().name();
                        conn.sendCommand("op " + botName);
                        conn.sendCommand("gamemode creative " + botName);
                        conn.sendCommand("tp " + botName + " " + origin.getX() + " " + (origin.getY() + 1) + " " + origin.getZ());
                    }
                }
            }
        }
    }

    private void onBuildSelectedSchematic() {
        com.example.builderbot.client.render.ClientGhostRenderer.clearGhostSchematic();
        if (selectedSchematicIndex < 0 || selectedSchematicIndex >= filteredSchematicFiles.size()) {
            if (Minecraft.getInstance().player != null) {
                Minecraft.getInstance().player.sendSystemMessage(
                    Component.literal("§c[BuilderBot] Please select a schematic from the library first!"));
            }
            return;
        }
        File selected = filteredSchematicFiles.get(selectedSchematicIndex);
        BlockPos origin = getTargetOrigin();
        if (origin == null) {
            if (Minecraft.getInstance().player != null) {
                Minecraft.getInstance().player.sendSystemMessage(
                    Component.literal("§c[BuilderBot] Please enter valid X, Y, Z coordinates before building!"));
            }
            return;
        }
        sendOpPrepCommands(origin);
        String coordArgs = buildCoordArgsString();
        runCommand("builderbot swarm " + selectedBotCount + " schematic " + selected.getName() + coordArgs);
        this.onClose();
    }

    private void onPreviewSchematic() {
        if (com.example.builderbot.client.render.ClientGhostRenderer.hasActiveGhost()) {
            com.example.builderbot.client.render.ClientGhostRenderer.clearGhostSchematic();
            this.init();
            return;
        }

        if (selectedSchematicIndex < 0 || selectedSchematicIndex >= filteredSchematicFiles.size()) {
            if (Minecraft.getInstance().player != null) {
                Minecraft.getInstance().player.sendSystemMessage(
                    Component.literal("§c[BuilderBot] Please select a schematic from the list first to preview!"));
            }
            return;
        }
        File selected = filteredSchematicFiles.get(selectedSchematicIndex);
        BlockPos origin = getTargetOrigin();
        if (origin == null) {
            if (Minecraft.getInstance().player != null) {
                Minecraft.getInstance().player.sendSystemMessage(
                    Component.literal("§c[BuilderBot] Please enter valid X, Y, Z coordinates before previewing!"));
            }
            return;
        }
        com.example.builderbot.client.render.ClientGhostRenderer.showGhostSchematic(
                selected.getName(), origin, selectedRotation);
        this.onClose();
    }

    private void onManualBuild() {
        com.example.builderbot.client.render.ClientGhostRenderer.clearGhostSchematic();
        String query = structureInput.getValue().trim();
        if (!query.isEmpty()) {
            BlockPos origin = getTargetOrigin();
            if (origin == null) {
                if (Minecraft.getInstance().player != null) {
                    Minecraft.getInstance().player.sendSystemMessage(
                        Component.literal("§c[BuilderBot] Please enter valid X, Y, Z coordinates before building!"));
                }
                return;
            }
            sendOpPrepCommands(origin);
            String coordArgs = buildCoordArgsString();
            if (query.endsWith(".litematic") || query.endsWith(".nbt")) {
                runCommand("builderbot swarm " + selectedBotCount + " schematic " + query + coordArgs);
            } else {
                runCommand("builderbot swarm " + selectedBotCount + " build " + query + coordArgs);
            }
            this.onClose();
        }
    }

    private void runCommand(String command) {
        if (Minecraft.getInstance().player != null && Minecraft.getInstance().player.connection != null) {
            var conn = Minecraft.getInstance().player.connection;

            // Translate directly into in-game bot chat commands for the Mineflayer swarm bots
            if (command.equals("builderbot op")) {
                conn.sendChat("!op");
            } else if (command.equals("builderbot undo") || command.contains("undo")) {
                conn.sendChat("!undo");
            } else if (command.equals("builderbot stop") || command.equals("builderbot stopall")) {
                conn.sendChat("!stop");
                conn.sendChat("!stopall");
                if (Minecraft.getInstance().player != null) {
                    Minecraft.getInstance().player.sendSystemMessage(
                        Component.literal("§c[BuilderBot] Stopping all fleet bots immediately..."));
                }
                conn.sendCommand("builderbot stopall");
            } else if (command.equals("builderbot tp")) {
                conn.sendChat("!come");
            } else if (command.equals("builderbot fly")) {
                conn.sendChat("!fly");
            } else if (command.startsWith("builderbot cleararea")) {
                String args = command.substring("builderbot cleararea".length()).trim();
                conn.sendChat("!cleararea " + args);
            } else if (command.equals("builderbot despawnall")) {
                conn.sendChat("!despawnall");
            } else if (command.equals("builderbot despawn")) {
                conn.sendChat("!despawn");
            } else if (command.contains("schematic ")) {
                String name = command.substring(command.indexOf("schematic ") + "schematic ".length()).trim();
                if (command.contains("swarm ") && selectedBotCount > 1) {
                    conn.sendChat("!schematic swarm " + selectedBotCount + " " + name);
                } else {
                    conn.sendChat("!schematic " + name);
                }
            } else if (command.contains(" build ")) {
                String name = command.substring(command.indexOf(" build ") + " build ".length()).trim();
                if (command.contains("swarm ") && selectedBotCount > 1) {
                    conn.sendChat("!schematic swarm " + selectedBotCount + " " + name);
                } else {
                    conn.sendChat("!schematic " + name);
                }
            }

            // Also invoke internal command if running in singleplayer server
            if (Minecraft.getInstance().hasSingleplayerServer() && !command.equals("builderbot stopall") && !command.equals("builderbot stop")) {
                conn.sendCommand(command);
            }
        }
    }

    @Override
    public void extractRenderState(GuiGraphicsExtractor guiGraphics, int mouseX, int mouseY, float delta) {
        // 1. Dim background world with translucent dark vignette
        guiGraphics.fill(0, 0, this.width, this.height, 0x88000000);

        // 2. Window Outer Glowing Border (1px cyan-blue accent outline)
        guiGraphics.fill(winX - 2, winY - 2, winX + winW + 2, winY + winH + 2, 0xFF0284C7);
        guiGraphics.fill(winX - 1, winY - 1, winX + winW + 1, winY + winH + 1, 0xFF0F172A);

        // 3. Deep Obsidian Slate Glassmorphism Modal Body
        guiGraphics.fill(winX, winY, winX + winW, winY + winH, 0xF50B0F19);

        // 4. Header Title Bar & Live Fleet Status Badge
        guiGraphics.fill(winX + 10, winY + 22, winX + winW - 10, winY + 23, 0xFF1E293B);
        guiGraphics.text(this.font, "⚡ BUILDER BOT COMMAND SUITE", winX + 14, winY + 8, 0xFF38BDF8);

        // Live Fleet Status
        if (com.example.builderbot.client.BuilderBotClient.liveBuildStatus != null &&
            (System.currentTimeMillis() - com.example.builderbot.client.BuilderBotClient.lastStatusUpdate < 60000)) {
            guiGraphics.text(this.font, com.example.builderbot.client.BuilderBotClient.liveBuildStatus, winX + winW - 175, winY + 8, 0xFFFBBF24);
        } else {
            BuildPlan plan = (bot instanceof BuilderBotEntity b) ? b.getCurrentPlan() : null;
            boolean isBuilding = plan != null && !plan.isEmpty();
            if (isBuilding) {
                String statusText = String.format("🔨 %d/%d (%d%%)",
                        plan.total() - plan.remaining(), plan.total(), plan.percentComplete());
                guiGraphics.text(this.font, statusText, winX + winW - 145, winY + 8, 0xFF38BDF8);
            } else {
                guiGraphics.text(this.font, "🟢 Fleet Ready (" + selectedBotCount + " Bots)", winX + winW - 145, winY + 8, 0xFF4ADE80);
            }
        }

        // ── TAB 0 CONTENT RENDERING ──────────────────────────────────────────
        if (currentTab == 0) {
            int rightX = winX + 214;
            int rightY = winY + 54;
            int rightW = winW - 228;

            // Section labels
            guiGraphics.text(this.font, "📍 Build Origin", rightX, rightY + 2, 0xFFFBBF24);
            guiGraphics.text(this.font, "🧭 Orientation", rightX, rightY + 54, 0xFFFBBF24);
            guiGraphics.text(this.font, "⚡ Workforce Fleet", rightX, rightY + 86, 0xFFFBBF24);

            // Left List Box Outer Frame & Slate Fill
            guiGraphics.fill(listX - 1, listY - 1, listX + listW + 1, listY + listH + 1, 0xFF1E293B);
            guiGraphics.fill(listX, listY, listX + listW, listY + listH, 0xDD0F172A);

            if (filteredSchematicFiles.isEmpty()) {
                guiGraphics.centeredText(this.font, "No schematics found", listX + (listW / 2), listY + 38, 0xFF64748B);
                guiGraphics.centeredText(this.font, "Click [Folder] to add", listX + (listW / 2), listY + 54, 0xFF475569);
            } else {
                int displayCount = Math.min(VISIBLE_ITEMS, filteredSchematicFiles.size() - scrollOffset);
                for (int i = 0; i < displayCount; i++) {
                    int itemIdx = scrollOffset + i;
                    File file = filteredSchematicFiles.get(itemIdx);
                    int itemTop = listY + (i * ITEM_HEIGHT);
                    boolean isSelected = (itemIdx == selectedSchematicIndex);
                    boolean isHovered = (mouseX >= listX && mouseX <= listX + listW - 6 && mouseY >= itemTop && mouseY < itemTop + ITEM_HEIGHT);

                    if (isSelected) {
                        // Cyan gradient highlight with glowing left edge
                        guiGraphics.fill(listX + 1, itemTop + 1, listX + listW - 7, itemTop + ITEM_HEIGHT - 1, 0xFF0369A1);
                        guiGraphics.fill(listX + 1, itemTop + 1, listX + 4, itemTop + ITEM_HEIGHT - 1, 0xFF38BDF8);
                    } else if (isHovered) {
                        guiGraphics.fill(listX + 1, itemTop + 1, listX + listW - 7, itemTop + ITEM_HEIGHT - 1, 0xFF1E293B);
                    }

                    String name = file.getName();
                    String icon = name.endsWith(".litematic") ? "📜 " : (name.endsWith(".nbt") ? "🧊 " : "📐 ");
                    if (name.length() > 22) name = name.substring(0, 19) + "...";
                    int textColor = isSelected ? 0xFFFFFFFF : (name.endsWith(".litematic") ? 0xFF38BDF8 : 0xFFA78BFA);
                    guiGraphics.text(this.font, icon + name, listX + 6, itemTop + 5, textColor);
                }

                // Scrollbar
                int scrollbarX = listX + listW - 5;
                guiGraphics.fill(scrollbarX, listY, scrollbarX + 4, listY + listH, 0xFF1E293B);
                int totalItems = filteredSchematicFiles.size();
                if (totalItems > VISIBLE_ITEMS) {
                    int thumbH = Math.max(12, (VISIBLE_ITEMS * listH) / totalItems);
                    int maxScroll = totalItems - VISIBLE_ITEMS;
                    int thumbY = listY + ((scrollOffset * (listH - thumbH)) / maxScroll);
                    guiGraphics.fill(scrollbarX, thumbY, scrollbarX + 4, thumbY + thumbH, 0xFF0284C7);
                }
            }
        } else if (currentTab == 1) {
            // TAB 1: Swarm Fleet & Tools Labels
            int leftX = winX + 14;
            int cardW = (winW - 36) / 2;
            int rightX = leftX + cardW + 8;
            int startY = winY + 54;

            guiGraphics.text(this.font, "👥 Fleet Allocation & Privileges", leftX, startY, 0xFFFBBF24);
            guiGraphics.text(this.font, "⚙ Construction & Site Tools", rightX, startY, 0xFFFBBF24);
        }

        super.extractRenderState(guiGraphics, mouseX, mouseY, delta);

        // Despawn Confirmation Modal
        if (showDespawnModal) {
            guiGraphics.fill(0, 0, this.width, this.height, 0xDD000000);
            int modalW = 290;
            int modalH = 120;
            int modalX = (this.width - modalW) / 2;
            int modalY = (this.height - modalH) / 2;

            guiGraphics.fill(modalX - 1, modalY - 1, modalX + modalW + 1, modalY + modalH + 1, 0xFFEF4444);
            guiGraphics.fill(modalX, modalY, modalX + modalW, modalY + modalH, 0xFA18181B);

            guiGraphics.centeredText(this.font, "⚠ CONFIRM DESPAWN", modalX + (modalW / 2), modalY + 12, 0xFFEF4444);
            guiGraphics.centeredText(this.font, "Choose which bots to remove:", modalX + (modalW / 2), modalY + 30, 0xFFF4F4F5);
            guiGraphics.centeredText(this.font, "Active tasks will be cancelled.", modalX + (modalW / 2), modalY + 44, 0xFFA1A1AA);

            this.approveDespawnThisBtn.extractRenderState(guiGraphics, mouseX, mouseY, delta);
            this.approveDespawnAllBtn.extractRenderState(guiGraphics, mouseX, mouseY, delta);
            this.cancelDespawnBtn.extractRenderState(guiGraphics, mouseX, mouseY, delta);
        }
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }
}
