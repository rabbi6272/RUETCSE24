"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";

import { Users } from "lucide-react";

import { anonymous } from "./ui/fonts";

const names = [
  "FATIN",
  "MUTTAQEEN",
  "MUGDHA",
  "SABID",
  "SUPRIO",
  "HASIBUR",
  "MOJIBUR",
  "SHAFAYET",
  "EMAM",
  "MOULY",
  "TANVIR",
  "MAHATHIR",
  "SIFAT",
  "DIPANNITA",
  "SADIA",
  "Abhi",
  "MAHIN",
  "DEEP",
  "MASUM",
  "SUMIT",
  "SHIHAB",
  "Khandaker",
  "MOHIDUL",
  "RAFI",
  "FAHMID",
  "UTSHA",
  "TANJIMA",
  "NAHIN",
  "Amio",
  "SOMUDRO",
  "MUNTASIR",
  "ARNOB",
  "ELEM",
  "ISRAT",
  "AFNAN",
  "SHOYKOT",
  "MALIHA",
  "AHSAN",
  "NEHAL",
  "MAHINUL",
  "JIMAN",
  "MARWA",
  "TAHMIM",
  "DIBYA",
  "YASIR",
  "RASHEDUL",
  "TIUS",
  "SHAMI",
  "OMI",
  "SADMAN",
  "SUDIPTO",
  "ANONNA",
  "AZAN",
  "NIRJAS",
  "SUPANTHO",
  "KAYES",
  "PARTHA",
  "ARSHI",
  "ARIFUL",
  "RABBI",
  "OVIJIT",
  "MASUM",
  "SABBIR",
  "SEAM",
  "SAMIR",
  "TANBIR",
  "NAEEM",
  "ARPITA",
  "KABIR",
  "SAROAR",
  "JIM",
  "PRONOB",
  "MAHMODUL",
  "SAMI",
  "BOBY",
  "SAKIB",
  "ROMJAN",
  "MEHEDI",
  "Maherab",
  "ANUP",
  "TASNIMUL",
  "MEHEDI",
  "RIMA",
  "SHAHRIAR",
  "MUBINUR",
  "LIMA",
  "ABID",
  "HIRA",
  "RAHI",
  "DAUD",
  "ANIKA",
  "FARIHA",
  "TANBIR",
  "SHADMAN",
  "RAHIDUL",
  "ABIR",
  "MONTAHA",
  "NAHID",
  "ASHIK",
  "AYMAN",
  "BRISTY",
  "MAHADI",
  "IMRUL",
  "PRANTO",
  "MUKIT",
  "MITHI",
  "ARIAN",
  "NUMAN",
  "ATHAI",
  "MUHIUDDIN",
  "TAUSIF",
  "SOURAV",
  "RIFAT",
  "AMY",
  "ISHRAK",
  "RAISA",
  "SHARIQUL",
  "MAHI",
  "NELOY",
  "URBOSHI",
  "AURPON",
  "ROHAN",
  "SAIMUS",
  "MUNNA",
  "FARDIN",
  "SHADHIN",
  "ZARIN",
  "TUSHER",
  "PRANTIK",
  "NIRJHAR",
  "WASIF",
  "SHAFAYAT",
  "SHEFAUL",
  "AFTAB",
  "TASFIA",
  "CHAITY",
  "SIFAT",
  "NAVID",
  "YEASIR",
  "SUJOY",
  "REZA",
  "MAHIM",
  "AHNAF",
  "KULSUM",
  "ADNAN",
  "RAFIO",
  "SAJID",
  "AHIN",
  "MUNTASIR",
  "BITTO",
  "PRITAM",
  "MADIHA",
  "RIJU",
  "ANTOR",
  "NIHAL",
  "AHAD",
  "KHUTBA",
  "FOUZIA",
  "FAHAD",
  "FAKID",
  "MAHMUD",
  "SINAN",
  "RAHUL",
  "SAID",
  "RABIB",
  "SADMAN",
  "RAIHAN",
  "MIRAJUL",
  "Mahbub",
  "SORNA",
  "WRIVU",
  "SHANTO",
  "OHANA",
  "MAMUN",
  "RATUL",
  "BAISHAKHY",
];

export default function HomePageClient(): React.ReactElement {
  const namesContainerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [mappedCount, setMappedCount] = useState(0);

  const colors = ["#7FFF00", "#00FFFF", "#FF69B4", "#FFD700", "#FF4500"];

  useEffect(() => {
    const shuffleArray = <T,>(array: T[]): T[] => {
      const shuffled = [...array];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    };

    const shuffledNames = shuffleArray(names);

    const animateTitle = () => {
      const title = titleRef.current;
      if (!title) return () => {};

      const drumChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-";
      const targetText = title.dataset.value || "CSE-24";
      const drumLength = drumChars.length;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const wheels = targetText.split("").map((char, index) => ({
        target: char,
        startOffset: Math.floor(Math.random() * drumLength),
        spins: 9 + index * 2 + Math.floor(Math.random() * 3),
      }));

      let frame = 0;

      const tick = () => {
        const nextFrameText = wheels
          .map((wheel, index) => {
            if (wheel.target === " ") return " ";

            const localFrame = frame - index * 3;
            if (localFrame < 0) {
              return drumChars[wheel.startOffset % drumLength];
            }
            if (localFrame >= wheel.spins) {
              return wheel.target;
            }

            const drumIndex = (wheel.startOffset + localFrame) % drumLength;
            return drumChars[drumIndex];
          })
          .join("");

        title.textContent = nextFrameText;

        const finished = wheels.every((wheel, index) => {
          if (wheel.target === " ") return true;
          return frame - index * 3 >= wheel.spins;
        });

        if (finished) {
          title.textContent = targetText;
          return;
        }

        frame += 1;
        timeoutId = setTimeout(tick, 50);
      };

      timeoutId = setTimeout(tick, 220);

      return () => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
      };
    };

    const stopTitleAnimation = animateTitle();

    const container = namesContainerRef.current;
    if (!container) return;

    const gridSize = 1;
    const grid: boolean[][] = Array.from(
      { length: Math.ceil(container.clientWidth / gridSize) },
      () => Array(Math.ceil(container.clientHeight / gridSize)).fill(false),
    );

    const getRandom = (min: number, max: number) =>
      Math.random() * (max - min) + min;

    const isOverlapping = (
      x: number,
      y: number,
      width: number,
      height: number,
    ): boolean => {
      const startX = Math.floor(x / gridSize);
      const startY = Math.floor(y / gridSize);
      const endX = Math.floor((x + width) / gridSize);
      const endY = Math.floor((y + height) / gridSize);

      for (let i = startX; i <= endX; i++) {
        for (let j = startY; j <= endY; j++) {
          if (grid[i] && grid[i][j]) return true;
        }
      }
      return false;
    };

    const markGrid = (x: number, y: number, width: number, height: number) => {
      const startX = Math.floor(x / gridSize);
      const startY = Math.floor(y / gridSize);
      const endX = Math.floor((x + width) / gridSize);
      const endY = Math.floor((y + height) / gridSize);

      for (let i = startX; i <= endX; i++) {
        for (let j = startY; j <= endY; j++) {
          if (grid[i]) grid[i][j] = true;
        }
      }
    };

    let count = 0;

    shuffledNames.forEach((name, index) => {
      setTimeout(() => {
        const span = document.createElement("span");
        span.classList.add("name");
        span.textContent = name.toUpperCase();
        span.style.color = colors[Math.floor(Math.random() * colors.length)];
        span.style.fontSize = getRandom(12, 24) + "px";

        container.appendChild(span);

        const width = span.offsetWidth;
        const height = span.offsetHeight;
        let x;
        let y;
        let attempts = 0;

        do {
          x = getRandom(10, container.clientWidth - width - 10);
          y = getRandom(10, container.clientHeight - height - 10);
          attempts++;
        } while (isOverlapping(x, y, width, height) && attempts < 500);

        if (!isOverlapping(x, y, width, height)) {
          span.style.left = x + "px";
          span.style.top = y + "px";
          markGrid(x, y, width, height);
          count++;
          setMappedCount(count);
        } else {
          span.remove();
        }
      }, index * 50);
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "F12" ||
        (e.ctrlKey && e.shiftKey && ["I", "J", "C"].includes(e.key)) ||
        (e.ctrlKey && e.key === "U")
      ) {
        e.preventDefault();
      }
    };

    const handleContextMenu = (e: MouseEvent) => e.preventDefault();
    const handleSelectStart = (e: Event) => e.preventDefault();

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("selectstart", handleSelectStart);

    return () => {
      stopTitleAnimation();
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("selectstart", handleSelectStart);
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#1a2421] text-white overflow-x-hidden">
      <style jsx global>{`
        .name {
          position: absolute;
          font-weight: bold;
          opacity: 0.8;
          pointer-events: none;
          white-space: nowrap;
          animation: fadeIn 1s ease-in-out forwards;
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: scale(0.5);
          }
          to {
            opacity: 0.8;
            transform: scale(1);
          }
        }

        @keyframes blow {
          0% {
            transform: scale(1);
            box-shadow: 0 0 10px rgba(0, 123, 255, 0.5);
          }
          50% {
            transform: scale(1.08);
            box-shadow: 0 0 20px rgba(0, 123, 255, 0.7);
          }
          100% {
            transform: scale(1);
            box-shadow: 0 0 10px rgba(0, 123, 255, 0.5);
          }
        }

        .profiles-button {
          animation: blow 1.5s infinite;
        }
      `}</style>

      <Link
        href="#directory"
        className="profiles-button fixed top-20 right-5 w-13 h-13 flex items-center justify-center bg-blue-600 text-white rounded-full no-underline text-2xl shadow-lg hover:bg-blue-700 transition-colors z-99999"
        aria-label="Browse student profiles"
      >
        <Users size={20} />
      </Link>

      <section className={`${anonymous.className} w-full p-2.5 text-center`}>
        <Image
          src="/RuetLogo.png"
          alt="Rajshahi University of Engineering and Technology logo"
          width={200}
          height={200}
          loading="eager"
          priority
          className="mx-auto h-auto w-auto animate-image-fade-in"
        />

        <h1
          ref={titleRef}
          className="text-5xl font-bold my-2 h-12.5"
          data-value="CSE-24"
        >
          CSE-24
        </h1>

        <h2 className="text-lg font-medium mt-1 animate-fade">
          Rajshahi University of Engineering and Technology CSE-2024 Batch
        </h2>

        <p className="text-lg mt-2.5 px-5 xl:px-10 max-w-4xl mx-auto animate-fade">
          <b>RUET CSE 24</b> is the student directory and batch archive for the
          Computer Science and Engineering 2024 cohort of Rajshahi University of
          Engineering and Technology.
        </p>
      </section>

      <div className="text-center animate-fade">
        <h3>Powered By &darr;</h3>
      </div>

      <div
        ref={namesContainerRef}
        className={`${anonymous.className} max-w-full h-150 mx-auto my-5 relative rounded-sm overflow-hidden`}
      />

      <div className="mt-4 text-lg font-bold text-[greenyellow] text-center">
        Mapped: {mappedCount}
      </div>

      <small className="block text-center text-gray-400">
        * Refresh the page for updated appearance.
      </small>

      <footer className="my-2 text-center">
        <small>
          <h4>All rights reserved by RUET_CSE_24</h4>
        </small>
      </footer>
    </div>
  );
}
