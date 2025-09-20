import React from "react";
import { Dumbbell, User, ArrowLeftRight, Settings2 } from "lucide-react";

export default function WallPushUpSetup() {
    return (
        <div className="max-w-2xl mx-auto p-5 bg-white rounded-2xl shadow-md space-y-6">
            {/* Title */}
            <h2 className="text-xl font-bold text-gray-900 text-center">
                🤸 Wall Push-Up – Setup Guide
            </h2>

            {/* Equipment */}
            <div className="bg-blue-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <Dumbbell className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Equipment</h3>
                </div>
                <p className="text-sm text-gray-600 text-center">
                    No equipment required. Optional: a non-slippery wall surface for better support.
                </p>
            </div>

            {/* Stance */}
            <div className="bg-green-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <User className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Stance</h3>
                </div>
                <p className="text-sm text-gray-600 text-center">
                    Stand facing the wall with <span className="font-medium">feet hip-width apart</span>. Place your hands on the wall at chest height and shoulder-width apart. Keep your back straight and core engaged.
                </p>
            </div>

            {/* Direction */}
            <div className="bg-yellow-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <ArrowLeftRight className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Movement Direction</h3>
                </div>
                <p className="text-sm text-gray-600 text-center">
                    Bend your elbows to bring your chest toward the wall, then push back to the starting position. Maintain a controlled motion and avoid locking elbows.
                </p>
            </div>

            {/* Basic Setup */}
            <div className="bg-purple-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <Settings2 className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Basic Setup</h3>
                </div>
                <ul className="space-y-2 text-sm text-gray-600 text-left">
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Keep your back straight and core engaged throughout the movement.</li>
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Elbows should bend slowly and evenly; do not lock out at the top.</li>
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Hands should remain at shoulder width and at chest height.</li>
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Ensure a stable wall and clear space around you to prevent slipping.</li>
                </ul>
            </div>
        </div>
    );
}
