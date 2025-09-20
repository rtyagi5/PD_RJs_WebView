import { User, ArrowDownUp, Settings2, Armchair } from "lucide-react";

export default function SeatedMarchSetup() {
    return (
        <div className="max-w-2xl mx-auto p-5 bg-white rounded-2xl shadow-md space-y-6">
            {/* Title */}
            <h2 className="text-xl font-bold text-gray-900 text-center">
                🪑 Seated Marches – Setup Guide
            </h2>

            {/* Equipment */}
            <div className="bg-blue-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <Armchair className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Equipment</h3>
                </div>
                <p className="text-sm text-gray-600 text-center">
                    A stable chair with feet flat on the floor. Optional: light ankle weights for added resistance.
                </p>
            </div>

            {/* Stance */}
            <div className="bg-green-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <User className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Stance</h3>
                </div>
                <p className="text-sm text-gray-600 text-center">
                    Sit tall on the chair with <span className="font-medium">feet flat</span> and knees bent at ~90 degrees. Keep your back straight and shoulders relaxed.
                </p>
            </div>

            {/* Direction */}
            <div className="bg-yellow-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <ArrowDownUp className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Movement Direction</h3>
                </div>
                <p className="text-sm text-gray-600 text-center">
                    Lift your knees alternately towards your chest in a <span className="font-medium">marching motion</span>. Keep movement smooth and controlled.
                </p>
            </div>

            {/* Basic Setup */}
            <div className="bg-purple-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <Settings2 className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Basic Setup</h3>
                </div>
                <ul className="space-y-2 text-sm text-gray-600 text-left">
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Keep your back straight and core engaged while sitting.</li>
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Lift knees one at a time, maintaining smooth, controlled movement.</li>
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Avoid leaning backward or slouching.</li>
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Use a chair with a stable base to ensure safety.</li>
                </ul>
            </div>
        </div>
    );
}
