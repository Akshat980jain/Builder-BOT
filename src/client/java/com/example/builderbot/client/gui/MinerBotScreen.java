package com.example.builderbot.client.gui;

import net.fabricmc.api.EnvType;
import net.fabricmc.api.Environment;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;

import java.util.ArrayList;
import java.util.List;

@Environment(EnvType.CLIENT)
public class MinerBotScreen extends Screen {

    private final String targetBotName;
    private int winX, winY, winW, winH;

    // Persistent values
    private String savedMineX = "";
    private String savedMineY = "";
    private String savedMineZ = "";

    private String savedChestX = "";
    private String savedChestY = "";
    private String savedChestZ = "";

    private String savedTargetY = "-58";

    // Coordinate Input Boxes
    private EditBox mineXBox;
    private EditBox mineYBox;
    private EditBox mineZBox;

    private EditBox chestXBox;
    private EditBox chestYBox;
    private EditBox chestZBox;

    private EditBox targetYBox;

    private String selectedStrategy = "strip_mine"; // "strip_mine", "ore_hunter", "tree_chopper"
    private String selectedSlope = "flat";          // "flat", "down", "up"
    private String selectedDirection = "north";     // "north", "south", "east", "west"
    private String selectedSize = "3x3";            // "1x2", "3x3", "4x4", "5x5"
    private String selectedDurationMode = "distance"; // "continuous", "timed", "distance"
    private int durationMinutes = 100;
    private String selectedSpeed = "1x";              // "1x", "2x", "5x", "max"
    private boolean isSwarmFleetMode = false;

    private final List<Button> pageWidgets = new ArrayList<>();

    public MinerBotScreen() {
        this("Miner_Bot");
    }

    public MinerBotScreen(String targetBotName) {
        super(Component.literal(((targetBotName != null && !targetBotName.isEmpty()) ? targetBotName : "Miner_Bot") + " Mission Control"));
        this.targetBotName = (targetBotName != null && !targetBotName.isEmpty()) ? targetBotName : "Miner_Bot";
    }

    @Override
    protected void init() {
        // Auto-detect current player or bot position on first open if empty
        if (savedMineX.isEmpty() || savedMineY.isEmpty() || savedMineZ.isEmpty()) {
            if (Minecraft.getInstance().player != null) {
                BlockPos pPos = Minecraft.getInstance().player.blockPosition();
                savedMineX = String.valueOf(pPos.getX());
                savedMineY = String.valueOf(pPos.getY());
                savedMineZ = String.valueOf(pPos.getZ());
                savedChestX = String.valueOf(pPos.getX());
                savedChestY = String.valueOf(pPos.getY());
                savedChestZ = String.valueOf(pPos.getZ());
            } else {
                savedMineX = "0"; savedMineY = "64"; savedMineZ = "0";
                savedChestX = "0"; savedChestY = "64"; savedChestZ = "0";
            }
        }

        // Save user inputs before recreating widgets
        if (mineXBox != null) savedMineX = mineXBox.getValue();
        if (mineYBox != null) savedMineY = mineYBox.getValue();
        if (mineZBox != null) savedMineZ = mineZBox.getValue();

        if (chestXBox != null) savedChestX = chestXBox.getValue();
        if (chestYBox != null) savedChestY = chestYBox.getValue();
        if (chestZBox != null) savedChestZ = chestZBox.getValue();

        if (targetYBox != null) savedTargetY = targetYBox.getValue();

        this.clearWidgets();
        pageWidgets.clear();

        this.winW = 440;
        this.winH = 270;
        this.winX = (this.width - winW) / 2;
        this.winY = (this.height - winH) / 2;

        int leftX = winX + 14;
        int cardW = (winW - 36) / 2;
        int rightX = leftX + cardW + 8;

        int rowTop = winY + 38;
        int colW = (cardW - 6) / 3;

        // ══════════════════════════════════════════════════════════════════════
        // ── 1. LEFT CARD: MINING SITE & ROUTE ─────────────────────────────────
        // ══════════════════════════════════════════════════════════════════════
        this.mineXBox = new EditBox(this.font, leftX, rowTop, colW, 16, Component.literal("MineX"));
        this.mineXBox.setValue(savedMineX);
        this.mineXBox.setHint(Component.literal("X").withStyle(ChatFormatting.DARK_GRAY));
        this.addRenderableWidget(mineXBox);

        this.mineYBox = new EditBox(this.font, leftX + colW + 3, rowTop, colW, 16, Component.literal("MineY"));
        this.mineYBox.setValue(savedMineY);
        this.mineYBox.setHint(Component.literal("Y").withStyle(ChatFormatting.DARK_GRAY));
        this.addRenderableWidget(mineYBox);

        this.mineZBox = new EditBox(this.font, leftX + (colW * 2) + 6, rowTop, colW, 16, Component.literal("MineZ"));
        this.mineZBox.setValue(savedMineZ);
        this.mineZBox.setHint(Component.literal("Z").withStyle(ChatFormatting.DARK_GRAY));
        this.addRenderableWidget(mineZBox);

        // Fill Buttons for Mine Position
        Button fillMinePlayerBtn = Button.builder(
                Component.literal("📍 My Pos").withStyle(ChatFormatting.AQUA),
                btn -> fillCoords(mineXBox, mineYBox, mineZBox, true)
        ).bounds(leftX, rowTop + 19, (cardW / 2) - 2, 16).build();
        addPageWidget(fillMinePlayerBtn);

        Button fillMineBotBtn = Button.builder(
                Component.literal("🤖 Bot Pos").withStyle(ChatFormatting.YELLOW),
                btn -> fillCoords(mineXBox, mineYBox, mineZBox, false)
        ).bounds(leftX + (cardW / 2) + 2, rowTop + 19, (cardW / 2) - 2, 16).build();
        addPageWidget(fillMineBotBtn);

        // Strategy & Theme Selector Row 1: [ ⛏ Strip ] [ 💎 Ores ] [ 🛣 Highway ] [ 🚆 Subway ]
        int stratBtnW = (cardW - 6) / 4;
        Button stratStripBtn = Button.builder(
                Component.literal("⛏ Strip").withStyle(selectedStrategy.equals("strip_mine") ? ChatFormatting.GOLD : ChatFormatting.GRAY),
                btn -> { this.selectedStrategy = "strip_mine"; this.init(); }
        ).bounds(leftX, rowTop + 37, stratBtnW, 15).build();
        addPageWidget(stratStripBtn);

        Button stratOreBtn = Button.builder(
                Component.literal("💎 Ores").withStyle(selectedStrategy.equals("ore_hunter") ? ChatFormatting.GOLD : ChatFormatting.GRAY),
                btn -> { this.selectedStrategy = "ore_hunter"; this.init(); }
        ).bounds(leftX + stratBtnW + 2, rowTop + 37, stratBtnW, 15).build();
        addPageWidget(stratOreBtn);

        Button stratHighwayBtn = Button.builder(
                Component.literal("🛣 Highway").withStyle(selectedStrategy.equals("highway_builder") ? ChatFormatting.GOLD : ChatFormatting.GRAY),
                btn -> { this.selectedStrategy = "highway_builder"; this.selectedSize = "5x5"; this.init(); }
        ).bounds(leftX + (stratBtnW * 2) + 4, rowTop + 37, stratBtnW, 15).build();
        addPageWidget(stratHighwayBtn);

        Button stratSubwayBtn = Button.builder(
                Component.literal("🚆 Subway").withStyle(selectedStrategy.equals("subway") ? ChatFormatting.GOLD : ChatFormatting.GRAY),
                btn -> { this.selectedStrategy = "subway"; this.selectedSize = "3x3"; this.init(); }
        ).bounds(leftX + (stratBtnW * 3) + 6, rowTop + 37, stratBtnW, 15).build();
        addPageWidget(stratSubwayBtn);

        // Theme Selector Row 2: [ 🏰 Castle ] [ 🌊 Ocean ] [ 🌌 Cyber ] [ 🌋 Nether ]
        Button stratCastleBtn = Button.builder(
                Component.literal("🏰 Castle").withStyle(selectedStrategy.equals("castle") ? ChatFormatting.GOLD : ChatFormatting.GRAY),
                btn -> { this.selectedStrategy = "castle"; this.selectedSize = "5x5"; this.init(); }
        ).bounds(leftX, rowTop + 54, stratBtnW, 15).build();
        addPageWidget(stratCastleBtn);

        Button stratOceanBtn = Button.builder(
                Component.literal("🌊 Ocean").withStyle(selectedStrategy.equals("aquarium") ? ChatFormatting.GOLD : ChatFormatting.GRAY),
                btn -> { this.selectedStrategy = "aquarium"; this.selectedSize = "5x5"; this.init(); }
        ).bounds(leftX + stratBtnW + 2, rowTop + 54, stratBtnW, 15).build();
        addPageWidget(stratOceanBtn);

        Button stratCyberBtn = Button.builder(
                Component.literal("🌌 Cyber").withStyle(selectedStrategy.equals("cyberpunk") ? ChatFormatting.GOLD : ChatFormatting.GRAY),
                btn -> { this.selectedStrategy = "cyberpunk"; this.selectedSize = "5x5"; this.init(); }
        ).bounds(leftX + (stratBtnW * 2) + 4, rowTop + 54, stratBtnW, 15).build();
        addPageWidget(stratCyberBtn);

        Button stratNetherBtn = Button.builder(
                Component.literal("🌋 Nether").withStyle(selectedStrategy.equals("nether_vault") ? ChatFormatting.GOLD : ChatFormatting.GRAY),
                btn -> { this.selectedStrategy = "nether_vault"; this.selectedSize = "5x5"; this.init(); }
        ).bounds(leftX + (stratBtnW * 3) + 6, rowTop + 54, stratBtnW, 15).build();
        addPageWidget(stratNetherBtn);

        // Slope / Staircase Selector Row: [ ⬇ Down ] [ ➡ Level ] [ ⬆ Up ]
        int slopeW = (cardW - 4) / 3;
        Button slopeDownBtn = Button.builder(
                Component.literal("⬇ Stairs Down").withStyle(selectedSlope.equals("down") ? ChatFormatting.YELLOW : ChatFormatting.GRAY),
                btn -> { this.selectedSlope = "down"; this.init(); }
        ).bounds(leftX, rowTop + 71, slopeW, 15).build();
        addPageWidget(slopeDownBtn);

        Button slopeFlatBtn = Button.builder(
                Component.literal("➡ Level Flat").withStyle(selectedSlope.equals("flat") ? ChatFormatting.AQUA : ChatFormatting.GRAY),
                btn -> { this.selectedSlope = "flat"; this.init(); }
        ).bounds(leftX + slopeW + 2, rowTop + 71, slopeW, 15).build();
        addPageWidget(slopeFlatBtn);

        Button slopeUpBtn = Button.builder(
                Component.literal("⬆ Stairs Up").withStyle(selectedSlope.equals("up") ? ChatFormatting.YELLOW : ChatFormatting.GRAY),
                btn -> { this.selectedSlope = "up"; this.init(); }
        ).bounds(leftX + (slopeW * 2) + 4, rowTop + 71, slopeW, 15).build();
        addPageWidget(slopeUpBtn);

        // Target Y-Level Depth & Height Row: [ EditBox ] [ 💎 -58 ] [ ⚙️ 12 ] [ ⛰️ 120 ]
        int targetYW = (cardW - 6) / 4;
        this.targetYBox = new EditBox(this.font, leftX, rowTop + 88, targetYW, 15, Component.literal("TargetY"));
        this.targetYBox.setValue(savedTargetY);
        this.targetYBox.setHint(Component.literal("Y: Depth").withStyle(ChatFormatting.DARK_GRAY));
        this.addRenderableWidget(targetYBox);

        Button yMinus58Btn = Button.builder(
                Component.literal("💎 -58").withStyle(savedTargetY.equals("-58") ? ChatFormatting.AQUA : ChatFormatting.GRAY),
                btn -> { this.savedTargetY = "-58"; if (targetYBox != null) targetYBox.setValue("-58"); this.init(); }
        ).bounds(leftX + targetYW + 2, rowTop + 88, targetYW, 15).build();
        addPageWidget(yMinus58Btn);

        Button y12Btn = Button.builder(
                Component.literal("⚙️ 12").withStyle(savedTargetY.equals("12") ? ChatFormatting.GOLD : ChatFormatting.GRAY),
                btn -> { this.savedTargetY = "12"; if (targetYBox != null) targetYBox.setValue("12"); this.init(); }
        ).bounds(leftX + (targetYW * 2) + 4, rowTop + 88, targetYW, 15).build();
        addPageWidget(y12Btn);

        Button y120Btn = Button.builder(
                Component.literal("⛰️ 120").withStyle(savedTargetY.equals("120") ? ChatFormatting.GREEN : ChatFormatting.GRAY),
                btn -> { this.savedTargetY = "120"; if (targetYBox != null) targetYBox.setValue("120"); this.init(); }
        ).bounds(leftX + (targetYW * 3) + 6, rowTop + 88, targetYW, 15).build();
        addPageWidget(y120Btn);

        // Direction Selector: [ ⬆ N ] [ ⬇ S ] [ ➡ E ] [ ⬅ W ]
        int dirW = (cardW - 6) / 4;
        String[] dirs = { "north", "south", "east", "west" };
        String[] dirLabels = { "⬆ N", "⬇ S", "➡ E", "⬅ W" };
        for (int i = 0; i < 4; i++) {
            final String d = dirs[i];
            Button dirBtn = Button.builder(
                    Component.literal(dirLabels[i]).withStyle(selectedDirection.equals(d) ? ChatFormatting.GREEN : ChatFormatting.GRAY),
                    btn -> { this.selectedDirection = d; this.init(); }
            ).bounds(leftX + (i * (dirW + 2)), rowTop + 105, dirW, 15).build();
            addPageWidget(dirBtn);
        }

        // Tunnel Area / Size Selector: [ 1x2 ] [ 3x3 ] [ 4x4 ] [ 5x5 ]
        String[] sizes = { "1x2", "3x3", "4x4", "5x5" };
        for (int i = 0; i < 4; i++) {
            final String s = sizes[i];
            Button sizeBtn = Button.builder(
                    Component.literal(s).withStyle(selectedSize.equals(s) ? ChatFormatting.AQUA : ChatFormatting.GRAY),
                    btn -> { this.selectedSize = s; this.init(); }
            ).bounds(leftX + (i * (dirW + 2)), rowTop + 122, dirW, 15).build();
            addPageWidget(sizeBtn);
        }

        // ══════════════════════════════════════════════════════════════════════
        // ── 2. RIGHT CARD: DEPOSIT & FLEET CONTROLS ───────────────────────────
        // ══════════════════════════════════════════════════════════════════════
        this.chestXBox = new EditBox(this.font, rightX, rowTop, colW, 16, Component.literal("ChestX"));
        this.chestXBox.setValue(savedChestX);
        this.chestXBox.setHint(Component.literal("X").withStyle(ChatFormatting.DARK_GRAY));
        this.addRenderableWidget(chestXBox);

        this.chestYBox = new EditBox(this.font, rightX + colW + 3, rowTop, colW, 16, Component.literal("ChestY"));
        this.chestYBox.setValue(savedChestY);
        this.chestYBox.setHint(Component.literal("Y").withStyle(ChatFormatting.DARK_GRAY));
        this.addRenderableWidget(chestYBox);

        this.chestZBox = new EditBox(this.font, rightX + (colW * 2) + 6, rowTop, colW, 16, Component.literal("ChestZ"));
        this.chestZBox.setValue(savedChestZ);
        this.chestZBox.setHint(Component.literal("Z").withStyle(ChatFormatting.DARK_GRAY));
        this.addRenderableWidget(chestZBox);

        Button fillChestPlayerBtn = Button.builder(
                Component.literal("📍 My Pos").withStyle(ChatFormatting.AQUA),
                btn -> fillCoords(chestXBox, chestYBox, chestZBox, true)
        ).bounds(rightX, rowTop + 19, (cardW / 2) - 2, 16).build();
        addPageWidget(fillChestPlayerBtn);

        Button fillChestBotBtn = Button.builder(
                Component.literal("🤖 Bot Pos").withStyle(ChatFormatting.YELLOW),
                btn -> fillCoords(chestXBox, chestYBox, chestZBox, false)
        ).bounds(rightX + (cardW / 2) + 2, rowTop + 19, (cardW / 2) - 2, 16).build();
        addPageWidget(fillChestBotBtn);

        // Duration Selectors: [ ♾️ 24/7 ] [ ⏱️ 30m ] [ ⏱️ 1h ] [ 📏 100b ]
        int durW = (cardW - 6) / 4;
        Button durContBtn = Button.builder(
                Component.literal("♾ 24/7").withStyle(selectedDurationMode.equals("continuous") ? ChatFormatting.GOLD : ChatFormatting.GRAY),
                btn -> { this.selectedDurationMode = "continuous"; this.init(); }
        ).bounds(rightX, rowTop + 39, durW, 16).build();
        addPageWidget(durContBtn);

        Button dur30Btn = Button.builder(
                Component.literal("⏱ 30m").withStyle((selectedDurationMode.equals("timed") && durationMinutes == 30) ? ChatFormatting.GOLD : ChatFormatting.GRAY),
                btn -> { this.selectedDurationMode = "timed"; this.durationMinutes = 30; this.init(); }
        ).bounds(rightX + durW + 2, rowTop + 39, durW, 16).build();
        addPageWidget(dur30Btn);

        Button dur60Btn = Button.builder(
                Component.literal("⏱ 1h").withStyle((selectedDurationMode.equals("timed") && durationMinutes == 60) ? ChatFormatting.GOLD : ChatFormatting.GRAY),
                btn -> { this.selectedDurationMode = "timed"; this.durationMinutes = 60; this.init(); }
        ).bounds(rightX + (durW * 2) + 4, rowTop + 39, durW, 16).build();
        addPageWidget(dur60Btn);

        Button durDistBtn = Button.builder(
                Component.literal("📏 100b").withStyle(selectedDurationMode.equals("distance") ? ChatFormatting.GOLD : ChatFormatting.GRAY),
                btn -> { this.selectedDurationMode = "distance"; this.durationMinutes = 100; this.init(); }
        ).bounds(rightX + (durW * 3) + 6, rowTop + 39, durW, 16).build();
        addPageWidget(durDistBtn);

        // Speed Multiplier Row: [ ⚡ 1x ] [ ⚡ 2x ] [ ⚡ 5x ] [ ⚡ MAX ]
        int spdW = (cardW - 6) / 4;
        Button spd1Btn = Button.builder(
                Component.literal("⚡ 1x").withStyle(selectedSpeed.equals("1x") ? ChatFormatting.AQUA : ChatFormatting.GRAY),
                btn -> { this.selectedSpeed = "1x"; this.init(); }
        ).bounds(rightX, rowTop + 57, spdW, 16).build();
        addPageWidget(spd1Btn);

        Button spd2Btn = Button.builder(
                Component.literal("⚡ 2x").withStyle(selectedSpeed.equals("2x") ? ChatFormatting.YELLOW : ChatFormatting.GRAY),
                btn -> { this.selectedSpeed = "2x"; this.init(); }
        ).bounds(rightX + spdW + 2, rowTop + 57, spdW, 16).build();
        addPageWidget(spd2Btn);

        Button spd5Btn = Button.builder(
                Component.literal("⚡ 5x").withStyle(selectedSpeed.equals("5x") ? ChatFormatting.GOLD : ChatFormatting.GRAY),
                btn -> { this.selectedSpeed = "5x"; this.init(); }
        ).bounds(rightX + (spdW * 2) + 4, rowTop + 57, spdW, 16).build();
        addPageWidget(spd5Btn);

        Button spdMaxBtn = Button.builder(
                Component.literal("⚡ MAX").withStyle(selectedSpeed.equals("max") ? ChatFormatting.RED : ChatFormatting.GRAY, ChatFormatting.BOLD),
                btn -> { this.selectedSpeed = "max"; this.init(); }
        ).bounds(rightX + (spdW * 3) + 6, rowTop + 57, spdW, 16).build();
        addPageWidget(spdMaxBtn);

        // Mode Selector: [ 👤 Single Bot (Name) ] [ 🤖 Swarm Fleet ]
        int modeW = (cardW - 4) / 2;
        Button singleBotBtn = Button.builder(
                Component.literal("👤 " + this.targetBotName).withStyle(!isSwarmFleetMode ? ChatFormatting.AQUA : ChatFormatting.GRAY),
                btn -> { this.isSwarmFleetMode = false; this.init(); }
        ).bounds(rightX, rowTop + 75, modeW, 16).build();
        addPageWidget(singleBotBtn);

        Button swarmFleetBtn = Button.builder(
                Component.literal("🤖 Swarm Fleet").withStyle(isSwarmFleetMode ? ChatFormatting.GOLD : ChatFormatting.GRAY),
                btn -> { this.isSwarmFleetMode = true; this.init(); }
        ).bounds(rightX + modeW + 4, rowTop + 75, modeW, 16).build();
        addPageWidget(swarmFleetBtn);

        // 1-Click Spawner Row
        int spawnW = (cardW - 4) / 3;
        Button spawn10Btn = Button.builder(
                Component.literal("🚀 10 Bots").withStyle(ChatFormatting.GOLD, ChatFormatting.BOLD),
                btn -> sendChatCommand("!spawn 10")
        ).bounds(rightX, rowTop + 93, spawnW + 10, 16).build();
        addPageWidget(spawn10Btn);

        Button spawn3Btn = Button.builder(
                Component.literal("➕ 3 Bots").withStyle(ChatFormatting.GREEN),
                btn -> sendChatCommand("!spawn 3")
        ).bounds(rightX + spawnW + 12, rowTop + 93, spawnW - 5, 16).build();
        addPageWidget(spawn3Btn);

        Button despawnBtn = Button.builder(
                Component.literal("➖ Dismiss").withStyle(ChatFormatting.RED),
                btn -> sendChatCommand("!despawn")
        ).bounds(rightX + (spawnW * 2) + 9, rowTop + 93, spawnW - 5, 16).build();
        addPageWidget(despawnBtn);

        // ══════════════════════════════════════════════════════════════════════
        // ── 3. BOTTOM ACTION DOCK ─────────────────────────────────────────────
        // ══════════════════════════════════════════════════════════════════════
        int bottomY = winY + winH - 50;

        // Launch Mission / Swarm Mission Button
        String launchText = isSwarmFleetMode ? "🚀 LAUNCH SYNCHRONIZED SWARM FLEET" : ("🚀 LAUNCH " + this.targetBotName.toUpperCase());
        Button launchBtn = Button.builder(
                Component.literal(launchText).withStyle(isSwarmFleetMode ? ChatFormatting.GOLD : ChatFormatting.GREEN, ChatFormatting.BOLD),
                btn -> onLaunchMission()
        ).bounds(winX + 14, bottomY, winW - 28, 20).build();
        addPageWidget(launchBtn);

        // Secondary controls: [ 🛑 Stop Selected ] [ 🛑 STOP ALL ] [ 📦 Deposit ] [ 📊 Stats ] [ ✖ Close ]
        int ctrlW = (winW - 28 - 16) / 5;
        Button stopBtn = Button.builder(
                Component.literal("🛑 Stop").withStyle(ChatFormatting.RED),
                btn -> sendChatCommand(isSwarmFleetMode ? "!swarmstop" : ("!bot " + this.targetBotName + " !stop"))
        ).bounds(winX + 14, bottomY + 24, ctrlW, 16).build();
        addPageWidget(stopBtn);

        Button stopAllBtn = Button.builder(
                Component.literal("🛑 STOP ALL").withStyle(ChatFormatting.DARK_RED, ChatFormatting.BOLD),
                btn -> sendChatCommand("!stopall")
        ).bounds(winX + 14 + (ctrlW + 4), bottomY + 24, ctrlW, 16).build();
        addPageWidget(stopAllBtn);

        Button depositBtn = Button.builder(
                Component.literal("📦 Deposit").withStyle(ChatFormatting.GREEN),
                btn -> {
                    String cX = chestXBox != null ? chestXBox.getValue().trim() : savedChestX;
                    String cY = chestYBox != null ? chestYBox.getValue().trim() : savedChestY;
                    String cZ = chestZBox != null ? chestZBox.getValue().trim() : savedChestZ;
                    if (!isSwarmFleetMode) {
                        sendChatCommand("/tp " + this.targetBotName + " " + cX + " " + cY + " " + cZ);
                        sendChatCommand("!bot " + this.targetBotName + " !deposit");
                    } else {
                        sendChatCommand("!swarmstop");
                    }
                }
        ).bounds(winX + 14 + (ctrlW + 4) * 2, bottomY + 24, ctrlW, 16).build();
        addPageWidget(depositBtn);

        Button statsBtn = Button.builder(
                Component.literal("📊 Stats").withStyle(ChatFormatting.YELLOW),
                btn -> sendChatCommand(isSwarmFleetMode ? "!bots" : ("!bot " + this.targetBotName + " !status"))
        ).bounds(winX + 14 + (ctrlW + 4) * 3, bottomY + 24, ctrlW, 16).build();
        addPageWidget(statsBtn);

        Button closeBtn = Button.builder(
                Component.literal("✖ Close").withStyle(ChatFormatting.WHITE),
                btn -> this.onClose()
        ).bounds(winX + 14 + (ctrlW + 4) * 4, bottomY + 24, ctrlW, 16).build();
        addPageWidget(closeBtn);
    }

    private void addPageWidget(Button btn) {
        pageWidgets.add(btn);
        this.addRenderableWidget(btn);
    }

    private void fillCoords(EditBox xBox, EditBox yBox, EditBox zBox, boolean usePlayer) {
        if (Minecraft.getInstance().level != null && Minecraft.getInstance().player != null) {
            BlockPos pos;
            if (usePlayer) {
                pos = Minecraft.getInstance().player.blockPosition();
            } else {
                var minerEntity = Minecraft.getInstance().level.players().stream()
                        .filter(p -> p.getName().getString().equalsIgnoreCase(this.targetBotName) || p.getName().getString().toLowerCase().contains(this.targetBotName.toLowerCase()))
                        .findFirst();
                pos = minerEntity.map(net.minecraft.world.entity.player.Player::blockPosition).orElseGet(() -> Minecraft.getInstance().player.blockPosition());
            }
            if (xBox != null) xBox.setValue(String.valueOf(pos.getX()));
            if (yBox != null) yBox.setValue(String.valueOf(pos.getY()));
            if (zBox != null) zBox.setValue(String.valueOf(pos.getZ()));

            savedMineX = mineXBox != null ? mineXBox.getValue() : savedMineX;
            savedMineY = mineYBox != null ? mineYBox.getValue() : savedMineY;
            savedMineZ = mineZBox != null ? mineZBox.getValue() : savedMineZ;
            savedChestX = chestXBox != null ? chestXBox.getValue() : savedChestX;
            savedChestY = chestYBox != null ? chestYBox.getValue() : savedChestY;
            savedChestZ = chestZBox != null ? chestZBox.getValue() : savedChestZ;
        }
    }

    private void onLaunchMission() {
        String mX = mineXBox != null ? mineXBox.getValue().trim() : savedMineX;
        String mY = mineYBox != null ? mineYBox.getValue().trim() : savedMineY;
        String mZ = mineZBox != null ? mineZBox.getValue().trim() : savedMineZ;

        String cX = chestXBox != null ? chestXBox.getValue().trim() : savedChestX;
        String cY = chestYBox != null ? chestYBox.getValue().trim() : savedChestY;
        String cZ = chestZBox != null ? chestZBox.getValue().trim() : savedChestZ;

        String dur = "0";
        if (selectedDurationMode.equals("timed")) {
            dur = "time:" + durationMinutes;
        } else if (selectedDurationMode.equals("distance")) {
            dur = "dist:" + durationMinutes;
        }

        String effStrategy = selectedStrategy;
        if (selectedSlope.equals("down")) {
            effStrategy = selectedStrategy + "_down";
        } else if (selectedSlope.equals("up")) {
            effStrategy = selectedStrategy + "_up";
        }

        String speedArg = "speed:" + selectedSpeed;
        String targetYVal = targetYBox != null ? targetYBox.getValue().trim() : savedTargetY;
        String targetYArg = !targetYVal.isEmpty() ? (" targetY:" + targetYVal) : "";

        if (isSwarmFleetMode) {
            sendChatCommand("!swarm " + mX + " " + mY + " " + mZ + " " + cX + " " + cY + " " + cZ + " " + dur + " " + effStrategy + " " + selectedDirection + " " + selectedSize + " " + speedArg + targetYArg);
        } else {
            // Player OP teleport to guarantee instant, 100% accurate positioning
            sendChatCommand("/tp " + this.targetBotName + " " + mX + " " + mY + " " + mZ);
            sendChatCommand("!bot " + this.targetBotName + " !mission " + mX + " " + mY + " " + mZ + " " + cX + " " + cY + " " + cZ + " " + dur + " " + effStrategy + " " + selectedDirection + " " + selectedSize + " " + speedArg + targetYArg);
        }

        this.onClose();
    }

    private void sendChatCommand(String cmd) {
        if (Minecraft.getInstance().player != null && Minecraft.getInstance().player.connection != null) {
            if (cmd.startsWith("/")) {
                Minecraft.getInstance().player.connection.sendCommand(cmd.substring(1));
            } else {
                Minecraft.getInstance().player.connection.sendChat(cmd);
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

        // 4. Header Accent Bar
        guiGraphics.fill(winX + 10, winY + 22, winX + winW - 10, winY + 23, 0xFF1E293B);

        // Header Title Banner with target bot name
        String titleText = isSwarmFleetMode ? "🤖 MINER BOT SWARM FLEET (10 BOTS)" : ("⛏ " + this.targetBotName.toUpperCase() + " MISSION CONTROL");
        guiGraphics.centeredText(this.font, titleText, winX + (winW / 2), winY + 9, 0xFF38BDF8);

        int leftX = winX + 14;
        int cardW = (winW - 36) / 2;
        int rightX = leftX + cardW + 8;
        int topY = winY + 26;

        // 5. Left & Right Card Backdrops (Frosted dark slate with borders)
        int cardBottom = winY + winH - 58;
        // Left Card Border & Fill
        guiGraphics.fill(leftX - 5, topY - 3, leftX + cardW + 5, cardBottom + 1, 0xFF1E293B);
        guiGraphics.fill(leftX - 4, topY - 2, leftX + cardW + 4, cardBottom, 0xDD0F172A);

        // Right Card Border & Fill
        guiGraphics.fill(rightX - 5, topY - 3, rightX + cardW + 5, cardBottom + 1, 0xFF1E293B);
        guiGraphics.fill(rightX - 4, topY - 2, rightX + cardW + 4, cardBottom, 0xDD0F172A);

        // Section Header Labels
        guiGraphics.text(this.font, "📍 1. Mining Site", leftX, topY + 2, 0xFFFBBF24);
        guiGraphics.text(this.font, "📦 2. Deposit & Fleet", rightX, topY + 2, 0xFFFBBF24);

        super.extractRenderState(guiGraphics, mouseX, mouseY, delta);
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }
}
