---
title: Power & Light
category: Power & Light
order: 1
summary: Solar panels, batteries, keeping phones and this library running, and safe lighting.
---
## Know your energy budget

**Watt-hours (Wh) = watts × hours.** A battery's Wh = volts × amp-hours (a 12 V 100 Ah battery ≈ 1,200 Wh, but use only half of a lead-acid battery to make it last).

| Device | Typical use |
|---|---|
| Phone charge | 10–20 Wh |
| LED light (5 W) for 5 hours | 25 Wh |
| This library (Raspberry Pi) for 24 h | 25–120 Wh depending on model |
| Radio receiver for a day | 5–20 Wh |
| Laptop charge | 50–90 Wh |
| 3D printer, 4-hour print | 200–400 Wh |
| Fridge for 24 h | 800–1,500 Wh |

## Solar

- A panel produces roughly **its rated watts × 4** Wh per day in decent sun (×1–2 in winter or cloud at high latitudes). A 100 W panel ≈ 400 Wh/day in summer.
- Face it toward the equator (south in the northern hemisphere, north in the southern), tilted at about your latitude. Re-aim it every few hours for 30% more energy.
- Keep it clean and unshaded — even partial shade on one cell can cut output by half.
- Use a **charge controller** between the panel and a 12 V battery. USB panels can charge phones and power banks directly.

## Batteries

- **Lithium (LiFePO4)**: best for deep cycling; lasts thousands of cycles. Don't charge below 0 °C.
- **Lead-acid (car, deep-cycle)**: heavy but common. Don't discharge below ~12.0 V (50%) and recharge fully soon after use. Car batteries die quickly from deep discharges.
- **Power banks** and laptop batteries: handy for USB devices.
- Scavenge: cars, UPS units, e-bikes, mobility scooters, solar garden lights (small cells + panels).
- **Never** short-circuit, puncture or overheat lithium batteries. Don't charge them unattended near flammable things.

## Car as a generator

A running car alternator delivers 500+ W; an inverter plugged into the 12 V socket gives ~150 W. Run the engine outdoors only (carbon monoxide). Idling uses about 1 litre of fuel per hour.

## Pedal and hand power

A fit person produces 50–100 W pedalling steadily. A bicycle on a stand driving a small motor/alternator can charge phones and batteries. Hand cranks give 5–20 W.

## Keeping this library alive

- A Raspberry Pi with a 10–20 W solar panel and a 12 V battery or large power bank can run continuously.
- Protect the device from water, heat and dust. Keep a spare SD card with the library on it, stored in a metal box.
- Shut it down properly when you can; sudden power loss can corrupt the card (the setup includes an option to make the system read-only to prevent this).

## Light

- LED torches and headlamps are hundreds of times more efficient than candles. Solar garden lights brought inside at night give a soft light.
- **Oil lamp**: a jar of vegetable oil, a cotton wick held by a wire or a tin-can lid with a hole, the wick end 1 cm above the oil. Never use petrol (gasoline).
- **Candles**: never leave unattended; stand in a tin or on a plate.
- **Tallow/fat lamp**: animal fat in a shell or tin with a moss or cloth wick.
- Fire is the leading cause of death after many disasters — keep flames away from curtains and bedding, keep water or sand nearby.
