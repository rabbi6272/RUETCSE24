import LocalFont from "next/font/local";

export const changaone = LocalFont({
  src: "ChangaOne.ttf",
  display: "swap",
  preload: true,
});

// Variable font (wght 200–1000), so one file covers every weight.
export const nunito = LocalFont({
  src: "Nunito.ttf",
  weight: "200 1000",
  display: "swap",
  preload: true,
  variable: "--font-nunito",
});
